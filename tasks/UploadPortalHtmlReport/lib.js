"use strict"

const { resolve, relative, basename, dirname, extname, isAbsolute, join } = require("path")
const { statSync, existsSync, readFileSync, writeFileSync } = require("fs")
const globby = require("globby")
const dashify = require("dashify")

const FORBIDDEN_KEYS = [
  "password",
  "passwd",
  "client_secret",
  "access_token",
  "refresh_token",
  "secret",
  "api_key",
  "apikey",
  "authorization"
]

const HTML_EXT = new Set([".html", ".htm"])
const ATTACHMENT_DELIMITER = "~"
const FAILED_TESTS_RE = /Failed Tests\s+([0-9]+)/i
const PLAYWRIGHT_UNEXPECTED_RE = /"unexpected"\s*:\s*([0-9]+)/
const ARCHIVE_IGNORE = ["**/node_modules/**", "**/.git/**", "**/.DS_Store"]
const MAX_INLINE_ASSET_BYTES = 2 * 1024 * 1024
const DEFAULT_MAX_ARCHIVE_BYTES = 50 * 1024 * 1024

const MIME_TYPES = {
  ".css": "text/css",
  ".js": "application/javascript",
  ".mjs": "application/javascript",
  ".json": "application/json",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".svg": "image/svg+xml",
  ".webp": "image/webp",
  ".ico": "image/x-icon",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".ttf": "font/ttf",
  ".eot": "application/vnd.ms-fontobject"
}

function toPosix(filePath) {
  return filePath.replace(/\\/g, "/")
}

function isHtmlFile(filePath) {
  return HTML_EXT.has(extname(filePath).toLowerCase())
}

function sortHtmlFiles(files) {
  return files.slice().sort((left, right) => {
    const leftIndex = basename(left).toLowerCase() === "index.html" ? 0 : 1
    const rightIndex = basename(right).toLowerCase() === "index.html" ? 0 : 1
    if (leftIndex !== rightIndex) {
      return leftIndex - rightIndex
    }
    return toPosix(left).localeCompare(toPosix(right))
  })
}

function findHtmlFiles(inputPath) {
  const resolved = resolve(inputPath)
  const stats = statSync(resolved)

  if (stats.isFile()) {
    if (!isHtmlFile(resolved)) {
      throw new Error(`Path is not an HTML file: ${resolved}`)
    }
    return [resolved]
  }

  if (!stats.isDirectory()) {
    throw new Error(`Path is not a file or directory: ${resolved}`)
  }

  return sortHtmlFiles(
    globby.sync(["**/*.{html,htm,HTML,HTM}"], {
      cwd: resolved,
      absolute: true,
      onlyFiles: true,
      followSymbolicLinks: false
    })
  )
}

function displayNameFor(filePath, rootPath) {
  const rootStats = statSync(rootPath)
  const root = rootStats.isDirectory() ? rootPath : dirname(rootPath)
  const relativePath = toPosix(relative(root, filePath))
  return relativePath || basename(filePath)
}

function sanitizePart(value, fallback) {
  const raw = value == null || value === "" ? fallback : String(value)
  return dashify(raw).replace(/~/g, "-") || fallback
}

function sanitizeTabName(value) {
  const raw = String(value == null || value === "" ? "HTML Report" : value)
    .replace(/~/g, "-")
    .trim()
  return raw || "HTML Report"
}

function generateAttachmentName({ tabName, jobName, stageName, stageAttempt, fileName }) {
  return [
    sanitizeTabName(tabName),
    sanitizePart(jobName, "job"),
    sanitizePart(stageName, "stage"),
    String(stageAttempt == null || stageAttempt === "" ? 1 : stageAttempt),
    toPosix(String(fileName || "report.html")).replace(/~/g, "-").replace(/[\\/]/g, "_")
  ].join(ATTACHMENT_DELIMITER)
}

function parseAttachmentName(name) {
  const delimiter = name.includes("~") ? "~" : "."
  const parts = name.split(delimiter)
  if (parts.length >= 5) {
    return {
      tabName: parts[0],
      jobName: parts[1],
      stageName: parts[2],
      stageAttempt: parts[3],
      fileName: parts.slice(4).join(delimiter)
    }
  }
  return {
    tabName: name,
    jobName: "",
    stageName: "",
    stageAttempt: "",
    fileName: name
  }
}

function isReportSuccessful(html) {
  if (typeof html !== "string") {
    return true
  }
  const newman = html.match(FAILED_TESTS_RE)
  if (newman) {
    return Number(newman[1]) === 0
  }
  const playwright = html.match(PLAYWRIGHT_UNEXPECTED_RE)
  if (playwright) {
    return Number(playwright[1]) === 0
  }
  return true
}

function shouldRedactKey(key) {
  const normalized = String(key).toLowerCase()
  if (FORBIDDEN_KEYS.includes(normalized)) {
    return true
  }
  return /password|secret|token|authorization/i.test(normalized)
}

function redactObject(value) {
  if (Array.isArray(value)) {
    return value.map(redactObject)
  }
  if (value && typeof value === "object") {
    const out = {}
    Object.keys(value).forEach((key) => {
      out[key] = shouldRedactKey(key) ? "***" : redactObject(value[key])
    })
    return out
  }
  return value
}

function redactJsonBlocks(document, selector) {
  document(selector)
    .nextAll()
    .find("code")
    .each(function () {
      const body = document(this).text()
      try {
        const parsed = JSON.parse(body)
        const attributesObj = document(this).attr() || {}
        const attributes = Object.keys(attributesObj)
          .map((key) => `${key}="${attributesObj[key]}"`)
          .join(" ")
        document(this).replaceWith(
          `<code ${attributes}>${JSON.stringify(redactObject(parsed), null, 2)}</code>`
        )
      } catch (error) {
        // Skip non-JSON payloads
      }
    })
}

function redactHtmlDocument(document) {
  document("td").each(function () {
    const text = document(this).text()
    if (/^\s*Bearer\s+\S+/i.test(text)) {
      document(this).text("Bearer ***")
    }
  })
  redactJsonBlocks(document, "h5:contains('Request Body')")
  redactJsonBlocks(document, "h5:contains('Response Body')")
  return document
}

function isRemoteOrSpecial(href) {
  const value = String(href || "").trim()
  if (!value) {
    return true
  }
  if (/^(data:|https?:|\/\/|blob:|mailto:|javascript:)/i.test(value)) {
    return true
  }
  if (value.charAt(0) === "#") {
    return true
  }
  return false
}

function resolveLocalPath(fromFile, href, rootDir) {
  if (isRemoteOrSpecial(href)) {
    return null
  }
  const cleaned = String(href).trim().split("#")[0].split("?")[0]
  if (!cleaned) {
    return null
  }
  const resolved = resolve(dirname(fromFile), cleaned)
  const root = resolve(rootDir)
  const rel = relative(root, resolved)
  if (!rel || rel.startsWith("..") || isAbsolute(rel)) {
    return null
  }
  if (!existsSync(resolved) || !statSync(resolved).isFile()) {
    return null
  }
  return resolved
}

function mimeFor(filePath) {
  return MIME_TYPES[extname(filePath).toLowerCase()] || "application/octet-stream"
}

function toDataUri(filePath) {
  const buffer = readFileSync(filePath)
  return `data:${mimeFor(filePath)};base64,${buffer.toString("base64")}`
}

function inlineCssUrls(cssText, cssFilePath, rootDir, warnings) {
  return cssText.replace(/url\(\s*(['"]?)([^'")]+)\1\s*\)/g, (match, quote, rawUrl) => {
    const local = resolveLocalPath(cssFilePath, rawUrl.trim(), rootDir)
    if (!local) {
      return match
    }
    if (statSync(local).size > MAX_INLINE_ASSET_BYTES) {
      warnings.push(`Skipped large CSS asset ${displayNameFor(local, rootDir)}`)
      return match
    }
    return `url(${quote}${toDataUri(local)}${quote})`
  })
}

function inlineLocalAssets(html, htmlPath, rootDir) {
  const warnings = []
  const inlined = []
  const { load } = require("cheerio")
  const document = load(html)
  const root = rootDir || dirname(htmlPath)

  function takeLocal(href) {
    const local = resolveLocalPath(htmlPath, href, root)
    if (!local) {
      return null
    }
    if (statSync(local).size > MAX_INLINE_ASSET_BYTES) {
      warnings.push(`Skipped large asset ${displayNameFor(local, root)}`)
      return null
    }
    return local
  }

  document('link[rel="stylesheet"][href]').each(function () {
    const href = document(this).attr("href")
    const local = takeLocal(href)
    if (!local) {
      return
    }
    const css = inlineCssUrls(readFileSync(local, "utf8"), local, root, warnings)
    const media = document(this).attr("media")
    const mediaAttr = media ? ` media="${media}"` : ""
    document(this).replaceWith(`<style${mediaAttr}>\n${css}\n</style>`)
    inlined.push(displayNameFor(local, root))
  })

  document("script[src]").each(function () {
    const src = document(this).attr("src")
    const local = takeLocal(src)
    if (!local) {
      return
    }
    const type = (document(this).attr("type") || "").toLowerCase()
    const source = readFileSync(local, "utf8")
    if (type === "module" && /\bimport\s/.test(source)) {
      warnings.push(`Cannot fully inline ES module ${displayNameFor(local, root)}`)
      return
    }
    const safe = source.replace(/<\/script/gi, "<\\/script")
    const typeAttr = type ? ` type="${document(this).attr("type")}"` : ""
    document(this).replaceWith(`<script${typeAttr}>\n${safe}\n</script>`)
    inlined.push(displayNameFor(local, root))
  })

  document("img[src], source[src], video[src], audio[src], image[href], image[xlink\\:href]").each(function () {
    const attr = document(this).attr("src") ? "src" : document(this).attr("href") ? "href" : "xlink:href"
    const value = document(this).attr(attr)
    const local = takeLocal(value)
    if (!local) {
      return
    }
    document(this).attr(attr, toDataUri(local))
    inlined.push(displayNameFor(local, root))
  })

  document('link[rel="icon"][href], link[rel="shortcut icon"][href]').each(function () {
    const href = document(this).attr("href")
    const local = takeLocal(href)
    if (!local) {
      return
    }
    document(this).attr("href", toDataUri(local))
    inlined.push(displayNameFor(local, root))
  })

  return {
    html: document.html(),
    inlined,
    warnings
  }
}

function listArchiveFiles(rootDir) {
  return globby.sync(["**/*"], {
    cwd: rootDir,
    absolute: false,
    onlyFiles: true,
    followSymbolicLinks: false,
    ignore: ARCHIVE_IGNORE
  }).sort()
}

async function createReportArchive(rootDir, outPath, maxBytes) {
  const JSZip = require("jszip")
  const limit = maxBytes || DEFAULT_MAX_ARCHIVE_BYTES
  const files = listArchiveFiles(rootDir)
  if (files.length === 0) {
    return { skipped: true, reason: "no files" }
  }

  let total = 0
  const zip = new JSZip()
  for (let i = 0; i < files.length; i++) {
    const rel = files[i]
    const abs = join(rootDir, rel)
    total += statSync(abs).size
    if (total > limit) {
      return { skipped: true, reason: "archive would exceed size limit", bytes: total }
    }
    zip.file(toPosix(rel), readFileSync(abs))
  }

  const buffer = await zip.generateAsync({ type: "nodebuffer", compression: "DEFLATE" })
  writeFileSync(outPath, buffer)
  return { skipped: false, bytes: buffer.length, files: files.length }
}

function parseSummaryPayload(payload) {
  if (Array.isArray(payload)) {
    return { reports: payload, archive: null }
  }
  if (payload && typeof payload === "object") {
    return {
      reports: payload.reports || [],
      archive: payload.archive || null
    }
  }
  return { reports: [], archive: null }
}

module.exports = {
  ATTACHMENT_DELIMITER,
  DEFAULT_MAX_ARCHIVE_BYTES,
  FORBIDDEN_KEYS,
  MAX_INLINE_ASSET_BYTES,
  createReportArchive,
  displayNameFor,
  findHtmlFiles,
  generateAttachmentName,
  inlineLocalAssets,
  isHtmlFile,
  isReportSuccessful,
  listArchiveFiles,
  parseAttachmentName,
  parseSummaryPayload,
  redactHtmlDocument,
  redactObject,
  resolveLocalPath,
  shouldRedactKey,
  sortHtmlFiles
}
