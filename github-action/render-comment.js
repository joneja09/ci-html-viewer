"use strict"

const { readFileSync, appendFileSync } = require("fs")
const { join } = require("path")
const {
  buildCommentMarkdown,
  githubPagesPreviewUrl,
  sanitizeArtifactName
} = require("./prepare")

function setOutput(name, value) {
  const dest = process.env.GITHUB_OUTPUT
  if (!dest) {
    console.log(`${name}=${value}`)
    return
  }
  const text = String(value)
  if (text.indexOf("\n") >= 0) {
    appendFileSync(dest, `${name}<<EOF\n${text}\nEOF\n`)
    return
  }
  appendFileSync(dest, `${name}=${text}\n`)
}

function runUrlFromEnv() {
  const server = process.env.GITHUB_SERVER_URL
  const repo = process.env.GITHUB_REPOSITORY
  const runId = process.env.GITHUB_RUN_ID
  if (server && repo && runId) {
    return `${server}/${repo}/actions/runs/${runId}`
  }
  return ""
}

function previewBaseUrlFromEnv(artifactName) {
  if (process.env.PREVIEW_BASE_URL) {
    return String(process.env.PREVIEW_BASE_URL).replace(/\/$/, "")
  }
  if (process.env.PREVIEW_OUTCOME !== "success") {
    return ""
  }
  return githubPagesPreviewUrl({
    owner: process.env.GITHUB_REPOSITORY_OWNER,
    repo: (process.env.GITHUB_REPOSITORY || "").split("/")[1],
    prNumber: process.env.PR_NUMBER,
    artifactName
  })
}

const outputDir = process.env.OUTPUT_DIR
if (!outputDir) {
  throw new Error("OUTPUT_DIR is required")
}

const summary = JSON.parse(readFileSync(join(outputDir, "summary.json"), "utf8"))
const name = summary.name || process.env.REPORT_NAME || "HTML Report"
const reports = summary.reports || []
const failedCount = reports.filter((report) => report.successful === false).length
const artifactName = sanitizeArtifactName(name)
const markdown = buildCommentMarkdown({
  name,
  reports,
  failedCount,
  runUrl: runUrlFromEnv(),
  artifactName,
  archiveIncluded: !!summary.archiveIncluded,
  previewBaseUrl: previewBaseUrlFromEnv(artifactName)
})

setOutput("comment-markdown", markdown)
