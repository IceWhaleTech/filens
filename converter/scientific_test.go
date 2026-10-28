package converter

import (
	"context"
	"encoding/json"
	"image/png"
	"os"
	"path/filepath"
	"testing"
)

func TestScientificImagesProduceUprightOCRRaster(t *testing.T) {
	data, err := os.ReadFile("testdata/scientific/manifest.json")
	if err != nil {
		t.Fatal(err)
	}
	var cases []struct{ Format, Input string }
	if err := json.Unmarshal(data, &cases); err != nil {
		t.Fatal(err)
	}
	e := testExtractor(t)
	referenceFile, err := os.Open("testdata/scientific/source.png")
	if err != nil {
		t.Fatal(err)
	}
	defer referenceFile.Close()
	reference, err := png.Decode(referenceFile)
	if err != nil {
		t.Fatal(err)
	}
	for _, c := range cases {
		t.Run(c.Format, func(t *testing.T) {
			called := false
			e.config.OCR = ocrFunc(func(_ context.Context, path string) (string, error) {
				f, err := os.Open(path)
				if err != nil {
					return "", err
				}
				defer f.Close()
				img, err := png.Decode(f)
				if err != nil {
					return "", err
				}
				if img.Bounds().Size() != reference.Bounds().Size() {
					t.Fatalf("unexpected OCR raster dimensions %v", img.Bounds())
				}
				intersection, union := 0, 0
				for y := 0; y < img.Bounds().Dy(); y++ {
					for x := 0; x < img.Bounds().Dx(); x++ {
						r, g, b, _ := img.At(x, y).RGBA()
						rr, gg, bb, _ := reference.At(x, y).RGBA()
						ink, refInk := r+g+b < 3*32768, rr+gg+bb < 3*32768
						if ink || refInk {
							union++
						}
						if ink && refInk {
							intersection++
						}
					}
				}
				if union == 0 || float64(intersection)/float64(union) < .85 {
					t.Fatalf("OCR raster orientation/contrast differs from application source: overlap=%d/%d", intersection, union)
				}
				called = true
				return "scientific OCR", nil
			})
			r, err := e.ExtractText(context.Background(), filepath.Join("testdata/scientific", c.Input), Options{})
			if err != nil || !r.Complete || !called {
				t.Fatalf("%+v: %v called=%t", r, err, called)
			}
		})
	}
}
