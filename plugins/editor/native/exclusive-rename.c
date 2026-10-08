#ifdef __linux__
#define _GNU_SOURCE
#endif
#include <errno.h>
#include <stdio.h>
#include <string.h>
#ifdef __linux__
#include <fcntl.h>
#endif

// Exit 17 means the destination exists; 18 means this kernel or volume lacks the primitive.
int main(int argc, char **argv) {
  if (argc != 3) return 2;
#ifdef __APPLE__
  if (renamex_np(argv[1], argv[2], RENAME_EXCL) == 0) return 0;
#elif __linux__
  if (renameat2(AT_FDCWD, argv[1], AT_FDCWD, argv[2], RENAME_NOREPLACE) == 0) return 0;
#else
  errno = ENOTSUP;
#endif
  if (errno == EEXIST || errno == ENOTEMPTY) return 17;
  if (errno == ENOSYS || errno == ENOTSUP || errno == EINVAL) return 18;
  fprintf(stderr, "%s", strerror(errno));
  return 1;
}
