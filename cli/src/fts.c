// OS metadata plumbing only. Constants and ABI come from the macOS SDK.
#include <fts.h>
#include <errno.h>
#include <stdint.h>
#include <stddef.h>
#include <sys/stat.h>

typedef int (*filens_entry_fn)(void *, const char *, int, int64_t, int);

int filens_fts_walk(const char *root, void *context, filens_entry_fn callback) {
    char *paths[] = {(char *)root, NULL};
    FTS *tree = fts_open(paths, FTS_PHYSICAL | FTS_NOCHDIR, NULL);
    if (!tree) return errno;
    int result = 0;
    for (;;) {
        errno = 0;
        FTSENT *entry = fts_read(tree);
        if (!entry) { result = errno; break; }
        if (entry->fts_info == FTS_DP) continue;
        int kind = 0, error = 0;
        int64_t bytes = 0;
        if (entry->fts_info == FTS_D) kind = 1;
        else if (entry->fts_info == FTS_F && entry->fts_statp) {
            kind = 2;
            bytes = entry->fts_statp->st_size;
        } else if (entry->fts_info == FTS_DNR || entry->fts_info == FTS_ERR || entry->fts_info == FTS_NS) {
            error = entry->fts_errno ? entry->fts_errno : EIO;
        }
        int action = callback(context, entry->fts_path, kind, bytes, error);
        if (action == 2) break;
        if (action == 1 && kind == 1 && fts_set(tree, entry, FTS_SKIP) != 0) {
            result = errno;
            break;
        }
    }
    if (fts_close(tree) != 0 && !result) result = errno;
    return result;
}
