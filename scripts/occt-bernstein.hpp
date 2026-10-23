#pragma once

// Evaluate the Bernstein basis with de Casteljau's recurrence. OCCT's
// AppCont table stores these same values for degrees 1..25 at Gauss points.
// The recurrence uses only sums and products of nonnegative values on [0,1],
// avoiding factorials, large binomial coefficients, and division near endpoints.
inline void FilensBernsteinValues (const int degree, const double parameter, double* values)
{
    const double complement = 1.0 - parameter;
    values[0] = 1.0;
    for (int order = 1; order <= degree; ++order) {
        double carried = 0.0;
        for (int i = 0; i < order; ++i) {
            const double previous = values[i];
            values[i] = carried + complement * previous;
            carried = parameter * previous;
        }
        values[order] = carried;
    }
}
