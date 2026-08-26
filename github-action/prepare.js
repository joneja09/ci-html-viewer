"use strict"

const { resolve, join, dirname } = require("path")
const { readFileSync, writeFileSync, mkdirSync, statSync } = require("fs")
const { tmpdir } = require("os")
const {
  findHtmlFiles,
  displayNameFor,
  isReportSuccessful,
  redactHtmlDocument,
  inlineLocalAssets,
  createReportArchive
} = require("../tasks/UploadPortalHtmlReport/lib")

const MAX_REDACT_BYTES = 5 * 1024 * 1024

function isTruthy(value, defaultValue) {
  if (value === undefined || value === null || value === "") {
    return defaultValue
  }
  const normalized = String(value).toLowerCase()
  if (normalized === "true" || normalized === "1" || normalized === "yes") {
    return true
  }
  if (normalized === "false" || normalized === "0" || normalized === "no") {
    return false
  }
  return defaultValue
}

function commentMarker(name) {
  return `<!-- ci-html-viewer:${name} -->`
}

function sanitizeArtifactName(name) {
  const cleaned = String(name || "html-report")
    .replace(/["<>:|?*\\/\r\n]+/g, "-")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .trim()
  return cleaned || "html-report"
}

function githubPagesPreviewUrl({ owner, repo, prNumber, artifactName }) {
  if (!owner || !repo || !prNumber || !artifactName) {
    return ""
  }
  return `https://${owner}.github.io/${repo}/pr/${prNumber}/${sanitizeArtifactName(artifactName)}`
}

function htmlFileUrl(previewBaseUrl, fileName) {
  if (!previewBaseUrl) {
    return ""
  }
  const base = String(previewBaseUrl).replace(/\/$/, "")
  const path = String(fileName || "").split("/").map(encodeURIComponent).join("/")
  return base + "/" + path
}

function reportCell(fileName, previewBaseUrl) {
  const url = htmlFileUrl(previewBaseUrl, fileName)
  if (!url) {
    return fileName
  }
  return `[${fileName}](${url})`
}

function statusLabel(successful) {
  return successful ? "passed" : "failed"
}

function statusIcon(successful) {
  return successful ? "✅" : "❌"
}

function buildCommentMarkdown({ name, reports, failedCount, runUrl, artifactName, archiveIncluded, previewBaseUrl }) {
  const marker = commentMarker(name)
  const passedCount = reports.length - failedCount
  const headline = failedCount
    ? `**${failedCount} failed**, ${passedCount} passed`
    : `**${passedCount} passed**`

  const rows = reports
    .map((report) => `| ${reportCell(report.fileName, previewBaseUrl)} | ${statusIcon(report.successful)} ${statusLabel(report.successful)} |`)
    .join("\n")

  const links = []
  if (previewBaseUrl) {
    links.push(`[Open HTML report](${htmlFileUrl(previewBaseUrl, "index.html")})`)
  }
  if (runUrl) {
    links.push(`[Workflow artifacts](${runUrl})`)
  }
  const extra = archiveIncluded
    ? `A zip of the original report folder is included in the **${artifactName}** artifact.`
    : `Inlined HTML is uploaded as the **${artifactName}** artifact.`
  const previewNote = previewBaseUrl
    ? " If an HTML link 404s, set GitHub Pages source to the `gh-pages` branch."
    : ""
  const linkBlock = links.length ? `\n${links.join(" · ")}\n` : "\n"

  return `${marker}
## ${name}

${headline} (${reports.length} report${reports.length === 1 ? "" : "s"})

| Report | Result |
| --- | --- |
${rows}
${linkBlock}${extra}${previewNote}
`
}

async function prepareReports(options) {
  const reportDir = resolve(options.reportDir)
  const name = options.name || "HTML Report"
  const inlineAssets = options.inlineAssets !== false
  const redactSecrets = !!options.redactSecrets
  const failOnEmpty = options.failOnEmpty !== false
  const publishArchive = options.publishArchive !== false
  const outputRoot = options.outputDir || join(options.tempDir || tmpdir(), "ci-html-viewer", String(Date.now()))
  const reportsDir = join(outputRoot, "reports")
  mkdirSync(reportsDir, { recursive: true })

  const reportStats = statSync(reportDir)
  const files = findHtmlFiles(reportDir)
  if (files.length === 0) {
    return {
      reports: [],
      failedCount: 0,
      empty: true,
      failOnEmpty,
      outputDir: outputRoot,
      artifactName: sanitizeArtifactName(name),
      archiveIncluded: false,
      markdown: `${commentMarker(name)}\n## ${name}\n\nNo HTML files found in \`${reportDir}\`.\n`
    }
  }

  const reports = []
  const root = reportStats.isDirectory() ? reportDir : dirname(reportDir)

  files.forEach((file) => {
    const relativeName = displayNameFor(file, reportDir)
    let html = readFileSync(file, "utf8")

    if (inlineAssets) {
      const inlined = inlineLocalAssets(html, file, root)
      html = inlined.html
    }

    if (redactSecrets && Buffer.byteLength(html, "utf8") <= MAX_REDACT_BYTES) {
      const { load } = require("cheerio")
      const document = load(html)
      redactHtmlDocument(document)
      html = document.html()
    }

    const outFile = join(reportsDir, relativeName)
    mkdirSync(dirname(outFile), { recursive: true })
    writeFileSync(outFile, html)

    reports.push({
      fileName: relativeName,
      successful: isReportSuccessful(html)
    })
  })

  writeFileSync(join(reportsDir, ".nojekyll"), "")
  const hasIndex = reports.some((report) => report.fileName.toLowerCase() === "index.html")
  if (!hasIndex && reports.length) {
    const items = reports
      .map((report) => {
        const href = report.fileName.split("/").map(encodeURIComponent).join("/")
        const label = report.fileName.replace(/&/g, "&amp;").replace(/</g, "&lt;")
        return `<li><a href="${href}">${label}</a> ${report.successful ? "passed" : "failed"}</li>`
      })
      .join("")
    const title = String(name).replace(/&/g, "&amp;").replace(/</g, "&lt;")
    writeFileSync(
      join(reportsDir, "index.html"),
      `<!doctype html><html><head><meta charset="utf-8"><title>${title}</title></head><body><h1>${title}</h1><ul>${items}</ul></body></html>\n`
    )
  }

  let archiveIncluded = false
  if (publishArchive && reportStats.isDirectory()) {
    const archivePath = join(outputRoot, "html-reports.zip")
    const archiveResult = await createReportArchive(reportDir, archivePath)
    archiveIncluded = !archiveResult.skipped
  }

  const failedCount = reports.filter((item) => item.successful === false).length
  const artifactName = sanitizeArtifactName(name)
  const markdown = buildCommentMarkdown({
    name,
    reports,
    failedCount,
    runUrl: options.runUrl,
    artifactName,
    archiveIncluded,
    previewBaseUrl: options.previewBaseUrl || ""
  })

  writeFileSync(
    join(outputRoot, "summary.json"),
    JSON.stringify({ version: 2, name, reports, archiveIncluded }, null, 2)
  )

  return {
    reports,
    failedCount,
    empty: false,
    failOnEmpty,
    outputDir: outputRoot,
    artifactName,
    archiveIncluded,
    markdown
  }
}

module.exports = {
  buildCommentMarkdown,
  commentMarker,
  githubPagesPreviewUrl,
  htmlFileUrl,
  isTruthy,
  prepareReports,
  sanitizeArtifactName
}
