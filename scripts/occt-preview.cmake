# Headers remain available, but no document persistence, display stack, unused
# importers, or exporters are linked. Some OCAF units register global factories
# at startup, which prevents LTO from discarding them just by removing callers.
list(FILTER OcctImportJSSourceFiles EXCLUDE REGEX "importer-(step|iges|brep|xcaf)[.]cpp$")
list(FILTER OcctSourceFiles EXCLUDE REGEX "/(AIS|Aspect|Bin[^/]*|CDF|CDM|DsgPrs|Font|FSD|Graphic3d|HLR[^/]*|IGES[^/]*|Image|LDOM[^/]*|Media|PCDM|Prs[^/]*|Select[^/]*|StdPrs|StdSelect|Storage|TData[^/]*|TDF|TDocStd|TFunction|TNaming|TPrsStd|XCAF[^/]*|STEPCAFControl|IGESCAFControl|Geom2dToIGES|GeomToIGES|GeomToStep|BRepToIGES[^/]*|TopoDSToStep|V3d)/")
