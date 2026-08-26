"use strict"

const { resolve, relative, basename, dirname, extname } = require("path")
const { statSync } = require("fs")
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

function toPosix(filePath) {
  return filePath.replace(/\\/g, "/")
}

function isHtmlFile(filePath) {
  return HTML_EXT.has(extname(filePath).toLowerCase())
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

  return globby
    .sync(["**/*.{html,htm,HTML,HTM}"], {
      cwd: resolved,
      absolute: true,
      onlyFiles: true,
      followSymbolicLinks: false
    })
    .sort()
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
  const match = html.match(FAILED_TESTS_RE)
  if (match) {
    return Number(match[1]) === 0
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

module.exports = {
  ATTACHMENT_DELIMITER,
  FORBIDDEN_KEYS,
  displayNameFor,
  findHtmlFiles,
  generateAttachmentName,
  isHtmlFile,
  isReportSuccessful,
  parseAttachmentName,
  redactHtmlDocument,
  redactObject,
  shouldRedactKey
}
