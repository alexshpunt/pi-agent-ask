#!/bin/sh
# Use the selected real Pi without changing its installation or user settings.
export PI_OFFLINE=1
exec "${ASK_TEST_PI_BINARY:-pi}" --session "$ASK_TEST_SESSION" "$@"
