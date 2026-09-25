# HRI Lab website

Source of **https://hripnu.github.io**, the website of the Human-Robot Interaction Lab
(HRI Lab), School of Mechanical Engineering, Pusan National University.

GitHub builds and publishes the site automatically. Edit a file, click **Commit changes**,
and the live site updates in about a minute. Nothing needs to be installed.

## Where things are

| To change…                                   | Edit this file              |
| -------------------------------------------- | --------------------------- |
| News (Home and Board › News)                 | `_data/news.yml`            |
| Publications and patents                     | `_data/publications.yml`    |
| Team: career, students, alumni               | `_data/team.yml`            |
| Research projects                            | `_data/research.yml`        |
| Videos (Board › Video)                       | `_data/videos.yml`          |
| Animated intro and Home text                 | `_data/home.yml`            |
| Email, phone, menu, site description         | `_config.yml`               |
| Colors (PNU blue and green) and fonts        | top of `assets/css/main.css`|
| Photos and figures                           | `assets/img/`               |

## How to edit on github.com

1. Open the repository on github.com and click the file (for example `_data/news.yml`).
2. Click the pencil icon (**Edit this file**).
3. Make the change, then click **Commit changes…** → **Commit changes**.
4. Wait about a minute and reload the site. The **Actions** tab shows the build. A red ✗ there
   usually means a typo in the file you just edited (see the tips at the end).

You can also ask Claude Code to make an update ("add this paper to the lab website").

## Recipes

### Add a news item

Paste a new entry into `_data/news.yml`, below the comments and above any earlier news
(newest first):

```yaml
- date: 2026-10-01
  text: "Welcome, Gildong Hong, our first M.S. student!"
```

The Home page shows the newest 5 (set by `news_on_home` in `_config.yml`) with an
**All news** link, and **Board › News** keeps every item. `text` can use `**bold**`, `*italic*`,
and `[a link](https://...)`. While the file has no entries, both show the `news_empty` sentence
from `_data/home.yml`.

### Add a publication

In `_data/publications.yml`, copy an entry in the right list (`journal` or `conference`),
paste it at the top of that list, and edit it:

```yaml
  - id: J5
    title: "Paper title"
    authors: "Min Jin Yang, Gildong Hong, and Jung Kim"
    venue: "IEEE Robotics and Automation Letters"
    details: "11.3 (2026)"
    badge: "RA-L"
    year: 2026
    doi: "10.1109/LRA.2026.1234567"
    video: ""            # optional: YouTube id
    award: ""            # optional, e.g. "Best Paper Award"
```

- `id`: the next number (J5, C8, P3, …). The Research page uses it to link projects to papers.
- Names listed under `highlight_authors` in `_config.yml` are shown in bold. Add new lab members there.
- Remove any optional line you don't need.

### Add a lab member

In `_data/team.yml`, add the person under the right role:

```yaml
  - role: "M.S. Student"
    people:
      - name: "Gildong Hong"
        photo: /assets/img/team/gildong-hong.webp   # optional
        email: "gildong@pusan.ac.kr"                 # optional
```

Upload the photo to `assets/img/team/`: open that folder on github.com and choose
**Add file → Upload files**. A square photo of about 400×400 px works best, and JPG or PNG is fine.
Everyone shares one grid of cards (photo, name, role, email), in the order of the roles;
a role with no people is skipped. The "Waiting for YOU" card always ends the grid; its wording is
`open_card` at the end of `_data/team.yml`.

### Add a video

Videos are on **Board › Video**. Paste at the top of `_data/videos.yml`. The id is the part
after `youtu.be/`:

```yaml
- youtube: AbCdEfGhIjk
  tag: "RA-L 2026"
  title: "Video title"
```

### Change a research project or the animated intro

- Research projects: `_data/research.yml`. Wrap words in `**double asterisks**` to highlight them.
- The animated intro on the Home page takes its wording from `_data/home.yml`: the welcome line,
  each research area's name and description, the states listed under a scene (`steps`), and the
  recruiting sentence. Each grey description is a list of lines; two lines of about 40 characters
  each keep the layout tidy. `intro_seconds` sets how long a scene stays on screen, and an area's own
  `seconds` overrides it.
- The drawings are in `_includes/art/` and their motion is in `assets/js/intro.js`. Ask Claude Code
  if you want to change what a scene shows.

### Menu and the Board

The menu is the `nav` list in `_config.yml`. **Board** has two sub-pages, News (`board/news.html`)
and Video (`board/video.html`): they drop down from the menu and appear as tabs at the top of
each Board page. To add another sub-page, add it under Board's `sub` in `_config.yml` and create
its page in `board/` (copy `board/news.html` and change `title` and `permalink`).

### Add a logo later

There's no logo yet; the header shows the lab name. When one is ready, put the image in
`assets/img/`, add it to `_includes/header.html` (inside the `brand` link), and add a
`<link rel="icon" ...>` line for the browser-tab icon in `_layouts/default.html`.

## Tips for editing YAML files

- Keep the indentation (spaces, never tabs) exactly as in the neighbouring entries.
- Put text in "double quotes" if it contains a colon (`:`) or starts with a special character.
- Dates are written `YYYY-MM-DD`.

## Preview on your own computer (optional)

Requires Ruby. It's already installed on the PC this site was built on (`C:\Ruby33-x64`).

```
bundle install
bundle exec jekyll serve
```

Then open http://localhost:4000.

## Credits

- Font: [Pretendard](https://github.com/orioncactus/pretendard) (SIL Open Font License, see
  `assets/fonts/pretendard/LICENSE.txt`), hosted with the site.
- Built with Jekyll on GitHub Pages.
