# Privacy

The short version: **your files never leave your device.** Ever.

## How it works

Unmeta has no server to send anything to. The site is just a page and a cleaning tool that load into your browser. From there, everything happens on your side: your browser reads the file, cleans it and hands the result back to you.

- **Not a single network request carries your files.** Not the files, and not anything about them — names, sizes or what we found inside.
- **We don’t store anything.** Not even on your device: close the tab and your files leave no trace.
- **We only remember your settings:** language, theme, cleaning mode and your Custom choices. They stay in your browser so you don’t have to pick them every time.
- **We never change your originals.** The cleaned file is a new copy with `_clean` in its name.

You only need the internet to load the site and the cleaning tool. The video and audio cleaner is fairly large, so it loads once — the first time you add a video or audio file. None of these downloads contain anything about you or your files.

Like any website, our host can see that the page was opened: your IP address and browser. It knows nothing about your files — they never reach it.

## Check it yourself

You don’t have to take our word for it.

**The easy way.** Open Unmeta and let it load. Turn off your internet — airplane mode works. Add a photo and clean it. It still works, which means your file has nowhere to go.

**If you’d like to look under the hood.** On a computer, open the developer tools (F12, or Option + Cmd + I on a Mac) and go to the **Network** tab. Clear the list, add a file, clean it and download the result. No new requests with your file will show up. The only thing that may load is the video cleaner the first time you add a video — and it travels *to* you, not from you.

## Open source

All of Unmeta’s code is open under the **AGPL-3.0** license: anyone can read it, check that it does exactly what this page says, and build the site themselves.

[Source code]({{REPO_URL}})
