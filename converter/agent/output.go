package agent

// These serializers map the response protocol only. Source document parsing,
// layout and Markdown/HTML/table exports are produced by the WASM core.
import (
	"encoding/csv"
	"encoding/json"
	"encoding/xml"
	"fmt"
	"html"
	"io"
	"sort"
	"strings"

	"go.yaml.in/yaml/v3"
)

func protocolValue(r Response) (any, error) {
	data, err := json.Marshal(r)
	if err != nil {
		return nil, err
	}
	var value any
	decoder := json.NewDecoder(strings.NewReader(string(data)))
	decoder.UseNumber()
	err = decoder.Decode(&value)
	return value, err
}
func writeStructured(w io.Writer, format string, r Response) error {
	value, err := protocolValue(r)
	if err != nil {
		return err
	}
	if format == "yaml" {
		// Decode numbers as ordinary JSON numbers for the YAML emitter. json.Number
		// is a string alias and would otherwise turn counts into quoted scalars.
		data, err := json.Marshal(r)
		if err != nil {
			return err
		}
		if err = json.Unmarshal(data, &value); err != nil {
			return err
		}
		encoder := yaml.NewEncoder(w)
		encoder.SetIndent(2)
		if err := encoder.Encode(value); err != nil {
			return err
		}
		return encoder.Close()
	}
	if _, err = io.WriteString(w, xml.Header); err != nil {
		return err
	}
	encoder := xml.NewEncoder(w)
	encoder.Indent("", "  ")
	if err := xmlValue(encoder, xml.StartElement{Name: xml.Name{Local: "filens"}}, value); err != nil {
		return err
	}
	if err := encoder.Flush(); err != nil {
		return err
	}
	_, err = io.WriteString(w, "\n")
	return err
}
func xmlValue(e *xml.Encoder, start xml.StartElement, value any) error {
	if err := e.EncodeToken(start); err != nil {
		return err
	}
	switch value := value.(type) {
	case map[string]any:
		keys := make([]string, 0, len(value))
		for key := range value {
			keys = append(keys, key)
		}
		sort.Strings(keys)
		for _, key := range keys {
			// JSON Schema and future metadata may have keys such as "$ref".
			child := xml.StartElement{Name: xml.Name{Local: "field"}, Attr: []xml.Attr{{Name: xml.Name{Local: "name"}, Value: key}}}
			if err := xmlValue(e, child, value[key]); err != nil {
				return err
			}
		}
	case []any:
		for _, item := range value {
			if err := xmlValue(e, xml.StartElement{Name: xml.Name{Local: "item"}}, item); err != nil {
				return err
			}
		}
	case nil:
	default:
		if err := e.EncodeToken(xml.CharData(fmt.Sprint(value))); err != nil {
			return err
		}
	}
	return e.EncodeToken(start.End())
}
func writeCapacityExport(w io.Writer, format string, r Response) error {
	data, err := json.MarshalIndent(r, "", "  ")
	if err != nil {
		return err
	}
	switch format {
	case "html":
		_, err = fmt.Fprintf(w, "<!doctype html>\n<html><head><meta charset=\"utf-8\"><title>filens capabilities</title></head><body><pre>%s</pre></body></html>\n", html.EscapeString(string(data)))
	case "markdown":
		_, err = fmt.Fprintf(w, "# filens capabilities\n\n```json\n%s\n```\n", data)
	case "csv", "tsv":
		writer := csv.NewWriter(w)
		if format == "tsv" {
			writer.Comma = '\t'
		}
		err = writer.WriteAll([][]string{{"kind", "content"}, {"capabilities", string(data)}})
	}
	return err
}
