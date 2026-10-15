#!/bin/sh
# The fixture's login shell (docs/site/snapshots.md § The fixture). A command, such as the Node's PATH probe,
# runs in a plain shell that reads no profile, so the PATH the capture set stays as it is. A terminal
# opened in the app shows this fixed screen instead of a real prompt, which would carry a real user
# name, host, and home folder.
case "$1" in
  -c | -lc | -lic | -ilc) shift && exec /bin/sh -c "$@" ;;
esac
green='\033[32m' blue='\033[34m' dim='\033[90m' reset='\033[0m'
printf "${blue}billing-api${reset} on ${green}main${reset}\n\$ uv run pytest\n"
printf "${dim}============================= test session starts ==============================${reset}\n"
printf "collected 14 items\n\n"
printf "tests/test_deliver.py ${green}....${reset}                                   [ 28%%]\n"
printf "tests/test_invoices.py ${green}......${reset}                                [ 71%%]\n"
printf "tests/test_vat.py ${green}....${reset}                                       [100%%]\n\n"
printf "${green}============================== 14 passed in 0.62s ==============================${reset}\n"
printf "${blue}billing-api${reset} on ${green}main${reset}\n\$ "
exec tail -f /dev/null
