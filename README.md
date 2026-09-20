# filens

**Universal file inspection and rendering runtime for Web, WASM and AI Agents.**

filens is an open-source file inspection and rendering library that brings support for a wide range of modern, legacy, and specialized file formats to the browser and other sandboxed environments.

It provides a unified interface for **previewing, parsing, rendering, extracting, and converting files** into practical representations such as images, text, metadata, and structured content.

filens currently covers five major categories:

- **Documents** - Office, PDF, plain text, WPS, iWork and other document formats
- **Media** - Images, video and other common multimedia formats
- **Archives** - Compressed archives, packages and executable formats
- **Design** - CAD, STL, 3D-printing and other engineering/design formats
- **Legacy** - Older and less-common formats that are difficult to handle with modern web-native tools

The WASM runtime makes filens suitable for **local-first and privacy-sensitive applications**, allowing files to be inspected and rendered without necessarily uploading them to a remote service.

filens can also expose an external **OCR callback**, allowing image-based documents and scanned content to be converted into searchable text while keeping the OCR engine independent from the core runtime.

## From Preview to Agent

filens is designed as more than a file viewer.

Its goal is to provide a common **file understanding layer** between applications and the underlying collection of file formats.

```text
                     filens
                        |
        +---------------+---------------+
        |               |               |
      Parse           Render          Extract
        |               |               |
     Metadata       Image Preview      Text
        |               |               |
        +---------------+---------------+
                        |
                    OCR / Convert
                        |
                  +-----+-----+
                  |           |
                 Web         Agent
                 WASM         CLI
```

The same capabilities can eventually be exposed through a CLI, making filens directly usable as a **file inspection tool for AI Agents**:

```bash
filens inspect document.docx
filens render drawing.dwg
filens extract archive.zip
filens convert legacy.doc --to text
filens ocr scanned.jpg
```

Instead of requiring every application or Agent to understand hundreds of individual file formats, filens provides a single, consistent interface for interacting with them.

**See the file. Understand the file. Work with the file.**

filens is the lens between applications and the world's files.
