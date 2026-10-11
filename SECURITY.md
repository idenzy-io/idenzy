# Security

Idenzy is an authentication service, so a vulnerability here is a vulnerability in every
application that signs its users in through it. Please report one privately.

## Reporting

Use GitHub's private vulnerability reporting: the **Report a vulnerability** button on this
repository's **Security** tab. Please do not open a public issue, pull request or discussion.

Include what you found, how to reproduce it, and what an attacker could do with it. We will
acknowledge a report within three working days and keep you informed while we fix it. We credit
reporters in the advisory unless you ask us not to.

## Scope

This repository's code, the SDK packages published from it, and the hosted service at idenzy.io.
Testing against the hosted service must stay within your own projects and accounts: no denial of
service, no social engineering, and no access to anybody else's data.

## Supported versions

The latest release of each npm package, and the hosted service as it runs today. A self-hosted
deployment is supported on the latest commit of `main`.
