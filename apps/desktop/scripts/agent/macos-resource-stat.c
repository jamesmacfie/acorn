#include <libproc.h>
#include <stdio.h>
#include <stdlib.h>
#include <sys/resource.h>

int main(int argc, char **argv) {
  putchar('{');
  for (int index = 1; index < argc; index++) {
    int pid = atoi(argv[index]);
    struct rusage_info_v4 info = {0};
    if (index > 1) putchar(',');
    printf("\"%d\":", pid);
    if (pid <= 0 || proc_pid_rusage(pid, RUSAGE_INFO_V4, (rusage_info_t *)&info) != 0) {
      fputs("null", stdout);
    } else {
      printf("{\"cpuNs\":%llu,\"physicalBytes\":%llu,\"wakeups\":%llu}",
        info.ri_user_time + info.ri_system_time,
        info.ri_phys_footprint,
        info.ri_interrupt_wkups);
    }
  }
  puts("}");
  return 0;
}
