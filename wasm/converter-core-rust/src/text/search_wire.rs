//! WASI command/result adapter around the shared retrieval implementation.
use super::*;

pub(super) fn execute(request: &Request, started: Instant) {
    let result = fs::read(&request.input)
        .map_err(|e| e.to_string())
        .and_then(|bytes| {
            if bytes.len() > 64 << 20 {
                return Err("search corpus exceeds 64 MiB".into());
            }
            serde_json::from_slice::<Value>(&bytes)
                .map_err(|e| e.to_string())
                .and_then(search::evaluate_value)
        });
    let wire = match result {
        Ok(payload) => ResultContract {
            ok: true,
            payload: Some(payload),
            ..Default::default()
        },
        Err(message) => ResultContract {
            ok: false,
            error_code: "invalid_search".into(),
            error_message: message,
            ..Default::default()
        },
    };
    if let Err(error) = write_result(&request.result, wire, started.elapsed().as_millis()) {
        eprintln!("{error}");
        process::exit(1);
    }
}
