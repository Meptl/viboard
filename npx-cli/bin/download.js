const https = require("https");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const GITHUB_REPOSITORY = "Meptl/vibe-kanban";
const CACHE_DIR = path.join(require("os").homedir(), ".vibe-kanban", "bin");

async function fetchJson(url) {
  return new Promise((resolve, reject) => {
    https
      .get(
        url,
        {
          headers: {
            Accept: "application/vnd.github+json",
            "User-Agent": "vibe-kanban-cli",
          },
        },
        (res) => {
      if (res.statusCode === 301 || res.statusCode === 302) {
        return fetchJson(res.headers.location).then(resolve).catch(reject);
      }
      if (res.statusCode !== 200) {
        return reject(new Error(`HTTP ${res.statusCode} fetching ${url}`));
      }
      let data = "";
      res.on("data", (chunk) => (data += chunk));
      res.on("end", () => {
        try {
          resolve(JSON.parse(data));
        } catch (e) {
          reject(new Error(`Failed to parse JSON from ${url}`));
        }
      });
        },
      )
      .on("error", reject);
  });
}

async function downloadFile(url, destPath, expectedSha256, onProgress) {
  return new Promise((resolve, reject) => {
    const file = fs.createWriteStream(destPath);
    const hash = crypto.createHash("sha256");

    https.get(url, (res) => {
      if (res.statusCode === 301 || res.statusCode === 302) {
        file.close();
        try {
          fs.unlinkSync(destPath);
        } catch {}
        return downloadFile(res.headers.location, destPath, expectedSha256, onProgress)
          .then(resolve)
          .catch(reject);
      }

      if (res.statusCode !== 200) {
        file.close();
        try {
          fs.unlinkSync(destPath);
        } catch {}
        return reject(new Error(`HTTP ${res.statusCode} downloading ${url}`));
      }

      const totalSize = parseInt(res.headers["content-length"], 10);
      let downloadedSize = 0;

      res.on("data", (chunk) => {
        downloadedSize += chunk.length;
        hash.update(chunk);
        if (onProgress) onProgress(downloadedSize, totalSize);
      });
      res.pipe(file);

      file.on("finish", () => {
        file.close();
        const actualSha256 = hash.digest("hex");
        if (expectedSha256 && actualSha256 !== expectedSha256) {
          try {
            fs.unlinkSync(destPath);
          } catch {}
          reject(new Error(`Checksum mismatch: expected ${expectedSha256}, got ${actualSha256}`));
        } else {
          resolve(destPath);
        }
      });
    }).on("error", (err) => {
      file.close();
      try {
        fs.unlinkSync(destPath);
      } catch {}
      reject(err);
    });
  });
}

async function ensureBinary(platform, binaryName, releaseTag, onProgress) {
  const cacheDir = path.join(CACHE_DIR, releaseTag, platform);
  const zipPath = path.join(cacheDir, `${binaryName}.zip`);

  if (fs.existsSync(zipPath)) return zipPath;

  fs.mkdirSync(cacheDir, { recursive: true });

  const assetName = `${binaryName}-${platform}.zip`;
  const url = `https://github.com/${GITHUB_REPOSITORY}/releases/download/${releaseTag}/${assetName}`;
  await downloadFile(url, zipPath, null, onProgress);

  return zipPath;
}

async function getLatestVersion() {
  const releases = await fetchJson(
    `https://api.github.com/repos/${GITHUB_REPOSITORY}/releases?per_page=1`,
  );

  if (!Array.isArray(releases) || releases.length === 0 || !releases[0].tag_name) {
    throw new Error(`No releases found for ${GITHUB_REPOSITORY}`);
  }

  return releases[0].tag_name;
}

module.exports = {
  GITHUB_REPOSITORY,
  CACHE_DIR,
  ensureBinary,
  getLatestVersion,
};
