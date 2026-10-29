<img src="https://www.incarn.co/logo-1024-medaillon.png" alt="Incarn" width="96" height="96">

# n8n-nodes-incarn

This is an n8n community node for [Incarn](https://www.incarn.co/en/developers). It
animates old family photos and ancestor portraits into short, lifelike videos
(a blink, a breath, a slight smile), keeping the face exactly the same.

[n8n](https://n8n.io/) is a fair-code licensed workflow automation platform.

[Installation](#installation) | [Operations](#operations) | [Credentials](#credentials) | [Usage](#usage) | [Resources](#resources)

## Installation

Follow the [installation guide](https://docs.n8n.io/integrations/community-nodes/installation/)
in the n8n community nodes documentation. The package name is `n8n-nodes-incarn`.

## Operations

**Animation**

- **Create**: animates a photo (binary file from a previous node, or a public image URL),
  with an optional motion prompt. Can wait for the video (usually 1 to 3 minutes) and
  attach the MP4 as a binary file. Uses 1 credit.
- **Get**: returns the status (`processing`, `succeeded` or `failed`) and the video URL of
  an animation, and can attach the MP4.

**Account**

- **Get**: returns the account email and the remaining credits.

## Credentials

Create an API key on [incarn.co/en/developers](https://www.incarn.co/en/developers)
(it starts with `ik_live_`), then add an **Incarn API** credential in n8n and paste the
key. n8n checks it against `GET /v1/account`.

API animations are prepaid: each one uses 1 credit and is delivered in full HD,
without a watermark.

## Usage

Typical workflow: **Google Drive Trigger** (new photo) → **Incarn** (Create, Wait for
Video on, Download Video on) → **Google Drive** (upload the MP4).

Accepted photos: JPG, PNG or WebP, up to 15 MB. Without a prompt, Incarn uses its
default gentle motion. Prompts are written in English and describe the motion only.

Instead of waiting, you can set **Options > Webhook URL** to an n8n Webhook node:
Incarn calls it with the animation (same JSON as **Get**) when the video is ready.

Errors are explicit: an invalid key (401), no credits left (402), or too many
animations running at once (429).

## Compatibility

Built and tested with n8n-workflow 2.16 (n8n 2.x). No runtime dependencies.

## Resources

- [n8n community nodes documentation](https://docs.n8n.io/integrations/#community-nodes)
- [Incarn API documentation](https://www.incarn.co/en/developers/docs)
- Support: support@incarn.co
