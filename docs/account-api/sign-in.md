# Sign-in approval in the account API

This page covers what a service's approval page must show when a person approves a sign-in code. Read it
before you build or change that page. It's part of [the account API](../account-api.md#sign-in), which
covers the device flow's routes.

## The device name proves nothing

`/device/code` takes no credential, so `deviceName` is whatever the asker sent. The sign-in plugin sends the
computer's host name, and an attacker can send the owner's. A person who approves an attacker's code gives
that attacker their account.

## What the page shows

The page must not present the name as proof of who is asking. Beside the name, it shows what the service
saw itself: the address the code request came from, and how long ago the code was made. It tells the person
never to approve a code that someone else sent them.

## Refresh tokens

A service can shorten the refresh token's life for a sign-in that has never registered a Node, so a token
used only to read and link runs out in days. The plugin treats that like any refused refresh, and the person
signs in again.
