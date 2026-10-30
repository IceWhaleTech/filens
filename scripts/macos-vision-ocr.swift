// Benchmark adapter only. Production document parsing and OCR policy stay in WASM.
import Foundation
import Vision
import ImageIO
import CoreGraphics

func recognize(_ input: [String: Any]) throws -> [String: Any] {
    let request = VNRecognizeTextRequest()
    request.recognitionLevel = .accurate
    request.recognitionLanguages = ["zh-Hans", "zh-Hant", "en-US"]
    request.usesLanguageCorrection = true
    request.automaticallyDetectsLanguage = true
    request.minimumTextHeight = 0
    if input["operation"] as? String == "health" {
        return ["provider": "apple-vision", "revision": request.revision,
                "languages": try request.supportedRecognitionLanguages()]
    }
    guard let path = input["path"] as? String,
          let source = CGImageSourceCreateWithURL(URL(fileURLWithPath: path) as CFURL, nil),
          let image = CGImageSourceCreateImageAtIndex(source, 0, nil) else {
        throw NSError(domain: "benchmark", code: 1,
                      userInfo: [NSLocalizedDescriptionKey: "Cannot decode image"])
    }
    let properties = CGImageSourceCopyPropertiesAtIndex(source, 0, nil) as? [CFString: Any]
    let rawOrientation = (input["orientation"] as? UInt32)
        ?? (properties?[kCGImagePropertyOrientation] as? NSNumber)?.uint32Value ?? 1
    let orientation = CGImagePropertyOrientation(rawValue: rawOrientation) ?? .up
    let sideways = [5, 6, 7, 8].contains(rawOrientation)
    let width = Double(sideways ? image.height : image.width)
    let height = Double(sideways ? image.width : image.height)
    let start = DispatchTime.now().uptimeNanoseconds
    try VNImageRequestHandler(cgImage: image, orientation: orientation).perform([request])
    let elapsed = Double(DispatchTime.now().uptimeNanoseconds - start) / 1_000_000
    let blocks: [[String: Any]] = (request.results ?? []).compactMap { observation in
        guard let candidate = observation.topCandidates(1).first else { return nil }
        // Vision uses a normalized bottom-left origin. Expose oriented, top-left pixels.
        let polygon = [observation.topLeft, observation.topRight,
                       observation.bottomRight, observation.bottomLeft].map {
            [Double($0.x) * width, (1 - Double($0.y)) * height]
        }
        return ["text": candidate.string, "confidence": candidate.confidence, "polygon": polygon]
    }
    return ["provider": "apple-vision", "text": blocks.map { $0["text"] as! String }.joined(separator: "\n"),
            "width": width, "height": height, "blocks": blocks, "inferenceMs": elapsed]
}

while let line = readLine() {
    autoreleasepool {
        let response: [String: Any]
        do {
            guard let input = try JSONSerialization.jsonObject(with: Data(line.utf8)) as? [String: Any]
            else { throw NSError(domain: "benchmark", code: 2) }
            response = try recognize(input)
        } catch {
            response = ["error": error.localizedDescription]
        }
        if let data = try? JSONSerialization.data(withJSONObject: response, options: [.sortedKeys]) {
            FileHandle.standardOutput.write(data)
            FileHandle.standardOutput.write(Data([10]))
        }
    }
}
