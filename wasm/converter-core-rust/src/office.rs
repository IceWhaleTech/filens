//! Office decryption belongs to the shared WASM core, including legacy formats.
use super::*;
use msoffice_crypto::{Error, Family, classify, decrypt_binary_office, decrypt_ooxml};

pub(super) fn convert_encrypted(request: &Request) -> Option<Result<(), ConvertError>> {
    if !(is_openxml_source(&request.source)
        || is_word_binary_source(&request.source)
        || is_biff_source(&request.source)
        || is_ppt_binary_source(&request.source))
    {
        return None;
    }
    let mut header = [0; 8];
    File::open(&request.input)
        .ok()?
        .read_exact(&mut header)
        .ok()?;
    if header != [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1] {
        return None;
    }
    if fs::metadata(&request.input).ok()?.len() > MAX_PACKAGE_BYTES {
        return Some(Err(parse_error(
            "Encrypted document exceeds the 256 MiB limit.".into(),
        )));
    }
    let input = match fs::read(&request.input) {
        Ok(input) => input,
        Err(_) => return Some(Err(io_error("Could not read encrypted document.".into()))),
    };
    let class = classify(&input);
    // Also recognize damaged OOXML envelopes, without calling a wrong password
    // the cause of a malformed encryption header.
    let envelope = CompoundFile::parse(&input).ok().is_some_and(|file| {
        file.entries
            .iter()
            .filter(|entry| entry.kind == 2 && !entry.path.contains('/'))
            .any(|entry| entry.name == "EncryptionInfo" || entry.name == "EncryptedPackage")
    });
    if !class.is_encrypted() && !envelope {
        return None;
    }
    Some((|| {
        if matches!(class.family, Family::Unsupported | Family::Irm) {
            return Err(ConvertError {
                code: "unsupported_format",
                message: "This document's encryption method is not supported.".into(),
            });
        }
        if request.password.is_empty() {
            return Err(ConvertError {
                code: "password_required",
                message: "This document requires a password.".into(),
            });
        }
        if class
            .password_key
            .as_ref()
            .and_then(|key| key.spin_count)
            .is_some_and(|count| count > 1_000_000)
        {
            return Err(parse_error(
                "Document password derivation exceeds the supported work limit.".into(),
            ));
        }
        // Check the declared plaintext length before the crypto library allocates it.
        if envelope {
            let file = CompoundFile::parse(&input)?;
            let entry = file
                .entries
                .iter()
                .filter(|entry| entry.kind == 2 && !entry.path.contains('/'))
                .find(|entry| entry.name == "EncryptedPackage")
                .ok_or_else(|| parse_error("Encrypted package is missing.".into()))?;
            if entry.size > MAX_PACKAGE_BYTES + (1 << 20) {
                return Err(parse_error(
                    "Encrypted package exceeds the supported size limit.".into(),
                ));
            }
            let package = file.read_stream(entry)?;
            let size = package
                .get(..8)
                .and_then(|bytes| bytes.try_into().ok())
                .map(u64::from_le_bytes)
                .ok_or_else(|| parse_error("Encrypted package is truncated.".into()))?;
            if size > MAX_PACKAGE_BYTES {
                return Err(parse_error(
                    "Decrypted package exceeds the 256 MiB limit.".into(),
                ));
            }
        }
        let decrypted = if envelope {
            decrypt_ooxml(&input, &request.password)
        } else {
            decrypt_binary_office(&input, &request.password)
        }
        .map_err(map_error)?;
        if decrypted.len() as u64 > MAX_PACKAGE_BYTES {
            return Err(parse_error(
                "Decrypted document exceeds the 256 MiB limit.".into(),
            ));
        }
        if envelope {
            normalize_package_reader(
                std::io::Cursor::new(&decrypted),
                &request.output,
                &request.target,
            )
        } else if is_word_binary_source(&request.source) {
            convert_word_binary_bytes(&decrypted, &request.output)
        } else if is_biff_source(&request.source) {
            convert_biff_bytes(&decrypted, &request.output)
        } else {
            convert_ppt_binary_bytes(&decrypted, &request.output)
        }
    })())
}

fn map_error(error: Error) -> ConvertError {
    match error {
        Error::WrongPassword => ConvertError {
            code: "password_invalid",
            message: "Incorrect password. Please try again.".into(),
        },
        Error::UnsupportedEncryptionVersion(..)
        | Error::UnsupportedAlgorithm { .. }
        | Error::UnsupportedEncryptedContent(_) => ConvertError {
            code: "unsupported_format",
            message: "This document's encryption method is not supported.".into(),
        },
        Error::IntegrityCheckFailed => parse_error(
            "Encrypted document integrity check failed; the file may be damaged.".into(),
        ),
        _ => {
            parse_error("The encrypted document is damaged or has invalid encryption data.".into())
        }
    }
}
