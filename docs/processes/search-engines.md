# Getting the project website into search engines

The project website, `https://lanewise.adrianeyre.co.uk/`, has what a search
engine and a link preview read on the page itself: a title and description, a
canonical URL, Open Graph and Twitter card tags with a 1200 × 630 image,
JSON-LD, `robots.txt` and a sitemap with its pictures (`website/README.md`,
"Search engines"). That gets the page indexed and previewed well. It doesn't
decide where the page ranks. That mostly comes from other sites linking to it
and people searching for it, which no change to the page can do.

This guide is for the owner of `adrianeyre/lanewise`. It covers the steps that
need the owner's own accounts, all of them free.

## Once

1. **Google Search Console.** Add `lanewise.adrianeyre.co.uk` as a Domain
   property at [search.google.com/search-console](https://search.google.com/search-console),
   and verify it with the TXT record it gives, in the domain's DNS. A DNS
   record proves it without a file or tag on the site. Then, under
   Sitemaps, submit `https://lanewise.adrianeyre.co.uk/sitemap.xml`, and use
   URL Inspection → Request indexing on the home page.
2. **Bing Webmaster Tools.** At [bing.com/webmasters](https://www.bing.com/webmasters),
   import the site from Search Console, which brings its verification and
   sitemap. Bing's index also serves DuckDuckGo, Yahoo, Ecosia and the web
   search of several AI assistants.
3. **The repository's topics.** GitHub lists a repository under its topics,
   and `adrianeyre/lanewise` has none. Its description and website are
   already set. For example:

   ```bash
   gh repo edit adrianeyre/lanewise --add-topic git,git-client,git-gui,desktop-app,tauri,rust,react,merge-conflicts,commit-graph,windows,macos
   ```

4. **Check the previews and the JSON-LD** after a deploy:
   - [Rich Results Test](https://search.google.com/test/rich-results) and the
     [Schema Markup Validator](https://validator.schema.org/): no errors. The
     Rich Results Test lists the SoftwareApplication with a warning that it
     has no rating or review. Google shows a software rich result only with
     one, and Lanewise has none to give, so the JSON-LD makes none up.
   - [LinkedIn's Post Inspector](https://www.linkedin.com/post-inspector/) and
     [Facebook's Sharing Debugger](https://developers.facebook.com/tools/debug/):
     the title, description and image. Each caches a preview, so use either
     to fetch it again after a change.

## Ongoing

- **Links to the website.** These do the most for ranking. Link the website,
  not only the repository, wherever Lanewise is listed or announced: a Show HN
  post, the relevant subreddits, AlternativeTo, Git client lists such as
  git-scm.com's GUI clients page (by its own process), and each Release's
  notes.
- **Search Console's reports**, every month or so: Pages, for anything not
  indexed and why, and Performance, for what people search to find Lanewise.
  The page's words should answer those searches. A change to them goes
  through a pull request, as any other does.
