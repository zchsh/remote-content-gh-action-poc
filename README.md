# GitHub Actions Test

This repo is meant to help me learn how to set up GitHub Actions.

Specifically, I want to set up an action that:

1. Ensures a `.generated` directory exists, for action output
2. Allows configuration of a `resourcesDir` variable, which determines the target folder from which frontmatter will be collected.
3. Collects a list of all target files in the target folder. For now, target files will be `*.mdx` files, but could make this filter configurable.
4. Collects frontmatter from all the target files, by reading their contents, and extracting frontmatter
   - Will likely use a tool like [`gray-matter`](https://www.npmjs.com/package/gray-matter)
   - This should result in an array of `{ __resourcePath, frontmatter }`, where `__resourcePath` is the path to the file relative to the target folder (eg, if `website/content` is the target folder in `packer`, then `website/content/docs/install.mdx` should have the `__resourcePath` of `docs/install.mdx`)
5. Writes the collected data to a `.generated/collected-frontmatter.json` file.
   - The top-level object should consist of `{ resourcesDir, resources }`, where `resourcesDir` is the path to the target folder within the repository (eg, `website/content` in the case of `packer`).
6. Commits the file to the repo, automatically (?)
   - Maybe there's something related to [`add-commit`](https://github.com/marketplace/actions/add-commit) that would be of use?
   - Maybe this is simpler and one can just run `git add .generated/collection-frontmatter.json` and `git commit -m "chore: update collected frontmatter`?

## To Do

- New format seems to work well
- Likely makes sense to write transform script based on above "collect frontmatter" script. NOT a GitHub action. Just a utility to help migrate from the old format to the new format.
- Specifically, can import `docs-navigation.js` into a copied version of `.github/scripts/collect-and-stage-frontmatter`. Rather than staging collected frontmatter...
  1. Use this imported `order` data, plus the frontmatter, to generate the new `.json` format.
  2. Note the (hopefully) explicit inclusion of `overview` pages.

## 2021-02-08 - Next Steps

- [ ] Move `path` vs `filepath` normalization into GitHub Action. Current format as proposed in the RFC feels like it presents some issues:
  1. How do we handle "Overview" / `index.mdx` files?
     - We could automatically add and title these pages via a GitHub Action
       - This seems to be what the RFC implies
       - We likely want to do a filesystem check as part of the action anyways, to missing files from silently breaking builds
       - We probably also want to allow "overriding" the auto-added pages by explicitly listing, eg to allow custom titles (?)
         - This makes things a bit more complicated though...
         - Maybe an explicit
     - We could require authors to explicitly list these files
       - For example, `{ "title": "Overview", "path": "commands/index" }`
       - `path` may be able to be shortened to `commands` rather than `commands/index` (see below)
     - **Proposed** approach is to require index pages to be **explicitly listed**
  2. When consuming content, how do we distinguish "named" file paths from "index" file paths?
     - Some paths reference an index file
       - For example `commands` >> `commands/index.mdx`
     - Other paths reference a named file
       - For example `terminology` >> `terminology.mdx`
     - We need to be able to do tell which is which to request the correct file path from the GitHub API
     - Option: index paths **must include the filename**
       - For example, we must have `commands/index`, and not `commands`
       - On the consumption side, we have to normalize the file path to the desired route
       - **🚨 This approach doesn't feel ideal**
     - Option: items with `title == "Overview"` are **assumed be index files**
       - When consuming content, we'd do something like `title === "Overview" ? fetchIndexFile() : fetchNamedFile()`
       - **🚨 But this feels brittle**, and requires consumption-side normalization (as above)
     - Option: check filesystem via GitHub action, and \*\*add `filePath` to each item
     - **Proposed** approach is to **automatically add a `filePath`** to each nav item via GitHub Actions
       - In this same Action, we can ensure the `filePath` actually exists
       - This will minimize errors fetching page content
       - It will also remove the need for path normalization in the deployment project that consumes content
       - ... and it could allow authors to imply index files like `commands` for `commands/index.mdx`
         - For each item, we'll try to resolve both `commands.mdx` and `commands/index.mdx`
         - If only one exists, great, we'll add that as the `filePath`
         - If neither exists, we throw an error - we're missing a file!
         - If both exists, we throw an error - it's ambiguous which file was intended.
