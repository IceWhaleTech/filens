#pragma once
#include <cstring>

struct FilensStepKeyword
{
    const char* name;
    int type;
};

// STEP keywords are ASCII and case-sensitive. Compare full byte lengths too:
// an embedded NUL followed by extra input must not alias a known keyword.
inline int FilensStepLookup(const FilensStepKeyword* entries, const int count,
                            const char* key, const int length)
{
    int first = 0, last = count;
    while (first < last) {
        const int middle = first + (last - first) / 2;
        const int order = std::strcmp(key, entries[middle].name);
        if (order < 0) last = middle;
        else if (order > 0) first = middle + 1;
        else return length == int(std::strlen(entries[middle].name)) ? entries[middle].type : 0;
    }
    return 0;
}
