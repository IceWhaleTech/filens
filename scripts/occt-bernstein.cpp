// Replacement for OCCT AppCont_ContMatrices_4.cxx. The upstream licenses
// accompany the generated runtime. Keep every supported degree and Gauss rule.
#include <AppCont_ContMatrices.hxx>
#include <math.hxx>
#include <math_Matrix.hxx>
#include <math_Vector.hxx>
#include <Standard_DimensionError.hxx>
#include <algorithm>
#include "filens-bernstein.hpp"

void VBernstein (const Standard_Integer classe,
                 const Standard_Integer nbpoints,
                 math_Matrix& matrix)
{
    if (classe < 2 || classe > 26 || nbpoints < 1 || nbpoints > 24) {
        throw Standard_DimensionError("VBernstein: unsupported degree or Gauss rule");
    }
    math_Vector points (1, nbpoints);
    math::GaussPoints (nbpoints, points);
    std::sort (&points(1), &points(1) + nbpoints);
    double values[26];
    for (int j = 1; j <= nbpoints; ++j) {
        FilensBernsteinValues (classe - 1, (points(j) + 1.0) * 0.5, values);
        for (int i = 1; i <= classe; ++i) matrix(i, j) = values[i - 1];
    }
}
