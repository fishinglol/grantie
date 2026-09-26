---
title: Privacy policy
description: What Granite does with your notes and your Google account. In short - your notes stay on your devices, and Google Drive sync is optional.
---

# Privacy policy

_Last updated: 26 September 2026_

Granite is a local-first Markdown note app for desktop and phone. This page says what it does with your data. The short
version: **your notes live on your own devices, Granite has no server that receives them, and signing in with Google is
optional.**

## Your notes

Notes are plain `.md` files (and the pictures you add) in a folder on your device: `Documents/GraniteVault` on the desktop
by default, or a folder you choose, and the app's private storage on the phone. Granite does not upload them anywhere
unless you turn on Google Drive sync (below). Nothing about your notes is sent to the Granite developers.

## Signing in with Google (optional)

You can use Granite without an account. If you choose **Continue with Google**, Granite asks Google for:

| Access | Why |
| --- | --- |
| Your name, email address and profile (`openid`, `email`, `profile`) | To show which account is connected. |
| `https://www.googleapis.com/auth/drive.file` | To keep a copy of your notes in Google Drive. This scope only lets Granite see and change **files and folders that Granite itself created**. The rest of your Drive is invisible to it. |

What Granite does with that access:

- It creates a folder called **Granite Vault** in your Drive and keeps it in step with your vault: your notes, their
  pictures, and the plugins you installed (the vault's `.granite` folder), in both directions.
- When you delete a note or folder in Granite, the copy in Drive is moved to Drive's trash. When you delete one in Drive,
  Granite removes it from the device.
- The data travels directly between your device and Google. Granite has no server in between, so the developers cannot see
  your notes, your files, your email address or your sign-in.

**Google API Services User Data Policy.** Granite's use and transfer to any other app of information received from Google
APIs adheres to the [Google API Services User Data Policy](https://developers.google.com/terms/api-services-user-data-policy),
including the Limited Use requirements. Granite uses this information only to provide the sync feature you asked for. It
does not sell it, use it for advertising, use it to train AI models, or let people read it.

### Where the sign-in is kept

The sign-in (a token that lets Granite reach your Drive without asking for your password again) is stored on your device
only, in the operating system's secure storage (Keychain on macOS and iOS, Keystore on Android; older phone versions kept it
in the app's private storage). **Sign out** in Granite revokes Granite's access with Google and removes the saved sign-in.
You can also remove Granite's access at any time on the
[Google permissions page](https://myaccount.google.com/permissions). Removing it does not delete your notes or the
**Granite Vault** folder. Both stay yours, and you can delete them whenever you like.

## Other connections Granite makes

Granite has no advertising, no analytics and no crash reporting. Apart from Google, it talks to these:

- **Plugin install counter.** The first time you install a plugin from the Store, the app sends one request to this site
  (`/api/installs/<plugin id>`) so the plugin's page can show how many people installed it. The request carries no body and
  nothing about you or your notes. To count each person once per day, the server keeps a **one-way hash** of your network
  address together with the plugin id for 24 hours, and a running total per plugin. It does not store the address itself.
  Like any web host, the hosting provider (Vercel) may keep ordinary request logs. The Store also reads the totals from the same place.
- **Phone updates.** The phone app checks Expo's update service for new versions of the app. Expo receives what any update
  check involves (the app and platform version, and the network address of the request), under
  [Expo's privacy policy](https://expo.dev/privacy).
- **Plugins.** Plugins run in a sandbox and can only do what they ask for and you allow; you see the list before you switch
  one on, and each device asks again if an update wants more. A plugin with the **Use the internet** permission can contact the
  sites it names. For example, the bundled **Smart Chips** plugin asks YouTube, Vimeo, Spotify, SoundCloud and TikTok for the
  title of a link you paste, which sends them that link. Read a plugin's permissions before you enable it.
- **Live Collab** (editing a note together with other people) is not available yet. When it is released, what it sends
  will be described here first.
- **Links and pictures in your notes.** If a note contains a picture from the web, your device fetches it from that site, as
  a browser would. Links open in your normal browser.

## Keeping and deleting data

- Your notes and settings stay on your device until you delete them. Uninstalling the app removes its settings and sign-in
  from that device. Note files that live in a folder you chose stay there.
- To delete what is in Drive, delete the **Granite Vault** folder in Google Drive.
- The only thing kept on our side is the plugin install totals described above (a number per plugin) and, for 24 hours, the
  hashes used to count each person once.

## Children

Granite is not directed at children under 13, and it does not knowingly collect information from them.

## Changes

If this policy changes, the date at the top changes with it. Granite is open source, so the history of this page is public in
the [repository](https://github.com/fishinglol/grantie).

## Contact

Questions about privacy: [putamafais@gmail.com](mailto:putamafais@gmail.com), or open an issue at
[github.com/fishinglol/grantie](https://github.com/fishinglol/grantie/issues).
