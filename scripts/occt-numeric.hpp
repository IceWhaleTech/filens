#pragma once
#include <cmath>

inline double FilensJacobiNorm(const int alpha, const int degree)
{
    double norm = 1.0;
    for (int k = 1; k <= alpha; ++k) norm *= double(degree + alpha + k) / double(degree + k);
    return std::sqrt(norm * (2 * degree + 2 * alpha + 1) / double(1 << (2 * alpha + 1)));
}

// Bernstein Gram matrix: integral B_i^n(t) B_j^n(t) dt on [0,1].
// For n <= 25 all Pascal coefficients, products and denominators here are
// integers below 2^53, so only the final division needs rounding. No inversion.
template <class Matrix>
void FilensGramMatrix(const int size, Matrix& matrix)
{
    double choose[51] = {1.0};
    double basis[26];
    const int degree = size - 1;
    for (int order = 1; order <= 2 * degree; ++order) {
        choose[order] = 1.0;
        for (int i = order - 1; i > 0; --i) choose[i] += choose[i - 1];
        if (order == degree)
            for (int i = 0; i < size; ++i) basis[i] = choose[i];
    }
    for (int i = 0; i < size; ++i)
        for (int j = 0; j < size; ++j)
            matrix(i + matrix.LowerRow(), j + matrix.LowerCol()) =
                (basis[i] * basis[j]) / ((2 * degree + 1) * choose[i + j]);
}

// A symmetric, centrosymmetric matrix is determined by the wedge
// 0 <= row <= col and row + col < size. Lookup preserves the stored doubles.
template <class Matrix>
void FilensPackedMatrix(const int size, const int firstSize,
                        const double* values, Matrix& matrix)
{
    for (int n = firstSize; n < size; ++n) values += (n + 1) * (n + 1) / 4;
    for (int i = 0; i < size; ++i) {
        for (int j = 0; j < size; ++j) {
            int row = i < j ? i : j;
            int col = i < j ? j : i;
            if (row + col >= size) {
                const int previous = row;
                row = size - 1 - col;
                col = size - 1 - previous;
            }
            matrix(i + matrix.LowerRow(), j + matrix.LowerCol()) = values[row * (size - row) + col];
        }
    }
}

// Gaussian integration weights for OCCT's normalized Jacobi basis.
// The recurrence is the same symmetric Jacobi recurrence used by D0123;
// multiply by (1-x*x)^(constraint+1) and the existing Gauss weight.
inline void FilensJacobiWeights(const int constraint, const int degree,
                                const double point, const double gaussWeight,
                                double* values)
{
    const int alpha = 2 * (constraint + 1);
    double factor = gaussWeight;
    for (int k = 0; k <= constraint; ++k) factor *= 1.0 - point * point;
    double previous = 0.0, current = 1.0;
    for (int i = 0; i <= degree; ++i) {
        if (i == 1) {
            previous = current;
            current = (alpha + 1) * point;
        } else if (i >= 2) {
            const double a = alpha + i - 1;
            const double twice = 2.0 * a;
            const double next = (twice * (twice + 1) * (twice + 2) * point * current
                - 2.0 * (twice + 2) * a * a * previous) / (2.0 * i * (i + 2 * alpha) * twice);
            previous = current;
            current = next;
        }
        const double norm = FilensJacobiNorm(alpha, i);
        values[i] = point == 0.0 && (i & 1) ? 0.0 : factor * norm * current;
    }
}

// Coefficients of t^k for the Hermite monomials and
// (1-t*t)^(constraint+1) times the normalized Jacobi polynomials. At a fixed
// power the recurrence and multiplication add terms of the same sign.
template <class Matrix>
void FilensJacobiTransform(const int constraint, const int degree, Matrix& matrix)
{
    const int alpha = 2 * (constraint + 1);
    double previous[62] = {}, current[62] = {1.0}, next[62];
    for (int row = 0; row <= degree; ++row)
        for (int col = 0; col <= degree; ++col)
            matrix(row + matrix.LowerRow(), col + matrix.LowerCol()) = row == col && col < alpha ? 1.0 : 0.0;
    for (int d = 0; d <= degree - alpha; ++d) {
        if (d >= 1) {
            const double a = alpha + d - 1;
            const double twice = 2.0 * a;
            for (int k = 0; k <= d; ++k) {
                if (d == 1) next[k] = k == 1 ? alpha + 1.0 : 0.0;
                else next[k] = (twice * (twice + 1) * (twice + 2) * (k ? current[k - 1] : 0.0)
                    - 2.0 * (twice + 2) * a * a * previous[k]) / (2.0 * d * (d + 2 * alpha) * twice);
            }
            for (int k = 0; k <= d; ++k) { previous[k] = current[k]; current[k] = next[k]; }
        }
        const double norm = FilensJacobiNorm(alpha, d);
        for (int k = 0; k <= degree; ++k) next[k] = k <= d ? current[k] * norm : 0.0;
        int highest = d;
        for (int factor = 0; factor <= constraint; ++factor) {
            highest += 2;
            for (int k = highest; k >= 2; --k) next[k] -= next[k - 2];
        }
        for (int k = 0; k <= highest; ++k)
            matrix(k + matrix.LowerRow(), d + alpha + matrix.LowerCol()) = next[k];
    }
}
