package converter

import (
	"context"
	"errors"
	"image/png"
	"io"
	"math"
	"os"
	"time"

	"github.com/klippa-app/go-pdfium"
	"github.com/klippa-app/go-pdfium/references"
	"github.com/klippa-app/go-pdfium/requests"
	"github.com/klippa-app/go-pdfium/webassembly"
	"github.com/tetratelabs/wazero"
)

// pdfBridge contains no extraction policy. It forwards the WASM core's page
// requests to the optional PDFium WASM module and releases each render at once.
type pdfBridge struct {
	pool     pdfium.Pool
	instance pdfium.Pdfium
	document references.FPDF_DOCUMENT
}

func (p *pdfBridge) closeDocument() {
	if p.document != "" && p.instance != nil {
		_, _ = p.instance.FPDF_CloseDocument(&requests.FPDF_CloseDocument{Document: p.document})
		p.document = ""
	}
}
func (p *pdfBridge) close() {
	p.closeDocument()
	if p.instance != nil {
		_ = p.instance.Close()
		p.instance = nil
	}
	if p.pool != nil {
		_ = p.pool.Close()
		p.pool = nil
	}
}
func (p *pdfBridge) call(ctx context.Context, operation, path string, index, dpi int) (any, error) {
	if err := ctx.Err(); err != nil {
		return nil, err
	}
	if p.pool == nil {
		pool, err := webassembly.Init(webassembly.Config{RuntimeConfig: wazero.NewRuntimeConfig().WithMemoryLimitPages(8192), MinIdle: 1, MaxIdle: 1, MaxTotal: 1, Stdout: io.Discard, Stderr: io.Discard})
		if err != nil {
			return nil, err
		}
		p.pool = pool
		p.instance, err = pool.GetInstance(30 * time.Second)
		if err != nil {
			p.close()
			return nil, err
		}
	}
	switch operation {
	case "pdf_open":
		p.closeDocument()
		bytes, err := os.ReadFile(path)
		if err != nil {
			return nil, err
		}
		doc, err := p.instance.OpenDocument(&requests.OpenDocument{File: &bytes})
		if err != nil {
			return nil, err
		}
		p.document = doc.Document
		count, err := p.instance.FPDF_GetPageCount(&requests.FPDF_GetPageCount{Document: p.document})
		if err != nil {
			return nil, err
		}
		return map[string]int{"pages": count.PageCount}, nil
	case "pdf_text":
		if p.document == "" {
			return nil, errors.New("PDF is not open")
		}
		value, err := p.instance.GetPageText(&requests.GetPageText{Page: requests.Page{ByIndex: &requests.PageByIndex{Document: p.document, Index: index}}})
		if err != nil {
			return nil, err
		}
		return map[string]string{"text": value.Text}, nil
	case "pdf_layout":
		if p.document == "" {
			return nil, errors.New("PDF is not open")
		}
		size, err := p.instance.FPDF_GetPageSizeByIndex(&requests.FPDF_GetPageSizeByIndex{Document: p.document, Index: index})
		if err != nil {
			return nil, err
		}
		if size.Width <= 0 || size.Height <= 0 || size.Width > 1_000_000 || size.Height > 1_000_000 || math.IsNaN(size.Width+size.Height) {
			return nil, errors.New("invalid PDF page geometry")
		}
		// Forward three PDFium page-to-device samples. The shared WASM core
		// reconstructs the coordinate transform, including crop/rotation.
		basis := make([]any, 0, 3)
		for _, point := range [][2]float64{{0, 0}, {1000, 0}, {0, 1000}} {
			position, err := p.instance.FPDF_PageToDevice(&requests.FPDF_PageToDevice{Page: requests.Page{ByIndex: &requests.PageByIndex{Document: p.document, Index: index}}, SizeX: int(math.Ceil(size.Width * 100)), SizeY: int(math.Ceil(size.Height * 100)), PageX: point[0], PageY: point[1]})
			if err != nil {
				return nil, err
			}
			basis = append(basis, position)
		}
		value, err := p.instance.GetPageTextStructured(&requests.GetPageTextStructured{Page: requests.Page{ByIndex: &requests.PageByIndex{Document: p.document, Index: index}}, Mode: requests.GetPageTextStructuredModeRects, CollectFontInformation: true})
		if err != nil {
			return nil, err
		}
		return map[string]any{"width": size.Width, "height": size.Height, "structured": value, "deviceBasis": basis}, nil
	case "pdf_render":
		if p.document == "" {
			return nil, errors.New("PDF is not open")
		}
		if dpi <= 0 || dpi > 300 {
			return nil, errors.New("invalid PDF render DPI")
		}
		size, err := p.instance.FPDF_GetPageSizeByIndex(&requests.FPDF_GetPageSizeByIndex{Document: p.document, Index: index})
		if err != nil {
			return nil, err
		}
		width, height := math.Ceil(size.Width*float64(dpi)/72), math.Ceil(size.Height*float64(dpi)/72)
		if width <= 0 || height <= 0 || math.IsNaN(width*height) || width*height > 32_000_000 {
			return nil, errors.New("PDF render exceeds pixel limit")
		}
		render, err := p.instance.RenderPageInDPI(&requests.RenderPageInDPI{DPI: dpi, Page: requests.Page{ByIndex: &requests.PageByIndex{Document: p.document, Index: index}}})
		if err != nil {
			return nil, err
		}
		defer render.Cleanup()
		if int64(render.Result.Image.Bounds().Dx())*int64(render.Result.Image.Bounds().Dy()) > 32_000_000 {
			return nil, errors.New("PDF render exceeds pixel limit")
		}
		file, err := os.OpenFile(path, os.O_WRONLY|os.O_CREATE|os.O_TRUNC, 0600)
		if err != nil {
			return nil, err
		}
		// This PNG is a short-lived, lossless OCR handoff. Favor CPU time over
		// compression ratio; every page is removed immediately after recognition.
		encoder := png.Encoder{CompressionLevel: png.BestSpeed}
		encodeErr := encoder.Encode(file, render.Result.Image)
		return map[string]bool{"ok": encodeErr == nil}, errors.Join(encodeErr, file.Close())
	}
	return nil, errors.New("unknown PDF operation")
}
