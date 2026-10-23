// Reuse the Emscripten C library's correctly rounded parser. OCCT's independent
// copy otherwise retains a second bigint engine and a 10 KiB powers-of-ten table.
#include <Standard_CString.hxx>
#include <Standard_CLocaleSentry.hxx>
#include <cstdlib>

double Strtod(const char* text, char** end)
{
    return strtod_l(text, end, Standard_CLocaleSentry::GetCLocale());
}
