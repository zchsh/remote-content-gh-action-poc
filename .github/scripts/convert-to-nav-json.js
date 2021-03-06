const fs = require("fs");
const path = require("path");
const grayMatter = require("gray-matter");
const klawSync = require("klaw-sync");
const navigationJs = require("../../website/data/docs-navigation");
// Temp - setting this up as part of a GitHub action, just to make
// things easier during dev, really the JSON format would be
// updated itself and the old format would be dropped
const util = require("util");
const exec = util.promisify(require("child_process").exec);

const INPUT_DIR = "website/content";
const OUTPUT_DIR = ".generated";
const OUTPUT_FILE = "docs-navigation.json";

convertAndWrite().then(() => {
  //  Stage the changes so they're ready to commit
  // (kind of relies on the outputDir, which is why it happens here)
  const outputFile = path.join(process.cwd(), OUTPUT_DIR, OUTPUT_FILE);
  exec(`git add ${outputFile}`).then(() => {
    console.log("✅ Done");
  });
});

async function convertAndWrite() {
  const fileFilter = (f) => path.extname(f.path) === ".mdx";
  const collectedFrontmatter = await collectFrontmatter(INPUT_DIR, fileFilter);
  const navJson = convertNavTree(
    navigationJs,
    collectedFrontmatter,
    [],
    "docs"
  );
  writeJsonFile(navJson, OUTPUT_DIR, OUTPUT_FILE);
}

function convertNavTree(navTree, collectedFrontmatter, pathStack, subfolder) {
  const convertedTree = navTree.map((navNode) => {
    // if the node is a string like '-----',
    // we want to render a divider
    const isString = typeof navNode === "string";
    const isDivider = isString && navNode.match(/^-+$/);
    if (isDivider) return { divider: true };
    // if the node is a string, but not a divider,
    // we want to render a leaf node
    if (isString)
      return convertNavLeaf(
        navNode,
        collectedFrontmatter,
        pathStack,
        subfolder
      );
    // if the node has an `href` or `title`, it's a direct link
    if (navNode.href || navNode.title) {
      // if a direct link doesn't have both `href` and `title`, we throw an error
      throw new Error(
        `Direct sidebar links must have both a "href" and "title". Found a direct link with only one of the two:\n\n ${JSON.stringify(
          navNode
        )}`
      );
    }
    // Otherwise, we expect the node to be a nested category
    return convertNavCategory(
      navNode,
      collectedFrontmatter,
      pathStack,
      subfolder
    );
  });
  return convertedTree;
}

function convertNavCategory(
  navNode,
  collectedFrontmatter,
  pathStack,
  subfolder
) {
  // Throw an error if the category is invalid
  if (!navNode.category || !navNode.content) {
    throw new Error(
      `Nav category nodes must have either a .name or .category property.`
    );
  }
  //  Process the navNode's nested content into the new format
  const nestedPathStack = pathStack.concat(navNode.category);
  const nestedRoutes = convertNavTree(
    navNode.content,
    collectedFrontmatter,
    nestedPathStack,
    subfolder
  );
  // Then, handle index data, which is a bit more of an undertaking...
  //  First, we try to gather index data for the entry
  //  The path we want for our new format does NOT contain
  // the content subfolder or the file extension (always `.mdx`)
  const USE_EXPLICIT_INDEX = false;
  const pathParts = USE_EXPLICIT_INDEX
    ? [navNode.category, "index"]
    : [navNode.category];
  const pathNewFormat = pathStack.concat(pathParts).join("/");
  // The path we need to match from the older format
  // includes the content subfolder as well as the file extension
  const pathFromSubfolder = `${pathNewFormat}${
    USE_EXPLICIT_INDEX ? "" : "/index"
  }.mdx`;
  const pathToMatch = path.join(subfolder, pathFromSubfolder);
  // Try to find the corresponding index page resource
  const matchedFrontmatter = collectedFrontmatter.filter((resource) => {
    return resource.__resourcePath === pathToMatch;
  })[0];
  const fmTitle = matchedFrontmatter
    ? matchedFrontmatter.sidebar_title || matchedFrontmatter.page_title
    : false;
  if (!fmTitle && !navNode.name) {
    throw new Error(
      `Nav category nodes must have either an index file with a sidebar_title or page_title in the frontmatter, or a .name property.`
    );
  }
  const title = fmTitle || navNode.name;
  // Set up an index page entry, if applicable
  const indexRoute = matchedFrontmatter
    ? {
        title: "Overview",
        path: pathNewFormat,
      }
    : false;

  // Finally, construct and return the category node
  const routes = indexRoute ? [indexRoute, ...nestedRoutes] : nestedRoutes;
  return {
    title: formatTitle(title),
    routes,
  };
}

function convertNavLeaf(navNode, collectedFrontmatter, pathStack, subfolder) {
  //  The path we want for our new format does NOT contain
  // the content subfolder or the file extension (always `.mdx`)
  const pathNewFormat = pathStack.concat(navNode).join("/");
  // The path we need to match from the older format
  // includes the content subfolder as well as the file extension
  const pathToMatch = path.join(subfolder, `${pathNewFormat}.mdx`);
  // We filter for matching frontmatter to get the "title" for the nav leaf.
  // We throw an error if there is no matching resource - there should be!
  const matchedFrontmatter = collectedFrontmatter.filter((resource) => {
    return resource.__resourcePath === pathToMatch;
  })[0];
  if (!matchedFrontmatter) {
    throw new Error(
      `Could not find frontmatter for resource path ${pathWithExt}.`
    );
  }
  // We pull the title from frontmatter.
  // We throw an error if there is no title in frontmatter - there should be!
  const { sidebar_title, page_title } = matchedFrontmatter;
  const title = sidebar_title || page_title;
  if (!title) {
    throw new Error(`Could not find title in frontmatter of ${pathWithExt}.`);
  }
  // Return the new format for the nav leaf
  return { title: formatTitle(title), path: pathNewFormat };
}

async function collectFrontmatter(inputDir, fileFilter) {
  // Traverse directories and parse frontmatter
  const targetFilepaths = klawSync(inputDir, {
    traverseAll: true,
    filter: fileFilter,
  }).map((f) => f.path);
  const inputDirPath = path.join(process.cwd(), inputDir);
  const collectedFrontmatter = await Promise.all(
    targetFilepaths.map(async (filePath) => {
      const rawFile = fs.readFileSync(filePath, "utf-8");
      const { data: frontmatter } = grayMatter(rawFile);
      const __resourcePath = path.relative(inputDirPath, filePath);
      return { __resourcePath, ...frontmatter };
    })
  );
  return collectedFrontmatter;
}

function formatTitle(title) {
  return title.replace(/<tt>/g, "<code>").replace(/<\/tt>/g, "</code>");
}

function writeJsonFile(data, dir, file) {
  // Set up a directory for output
  const outputDir = path.join(process.cwd(), dir);
  const outputFile = path.join(outputDir, file);
  fs.mkdirSync(outputDir, { recursive: true });
  //  Stringify the collected frontmatter, and write the file
  const fileString = JSON.stringify(data, null, 2);
  fs.writeFileSync(outputFile, fileString);
  return true;
}
