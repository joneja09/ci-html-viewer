"use strict"

const { appendFileSync } = require("fs")
const { tmpdir } = require("os")
const { prepareReports, isTruthy } = require("./prepare")

function readInput(name) {
  const underscored = "INPUT_" + name.replace(/-/g, "_").toUpperCase()
  const dashed = "INPUT_" + name.toUpperCase()
  if (process.env[underscored] !== undefined) {
    return process.env[underscored]
  }
  return process.env[dashed]
}

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

function writeStepSummary(markdown) {
  const dest = process.env.GITHUB_STEP_SUMMARY
  if (!dest) {
    process.stdout.write(markdown)
    return
  }
  appendFileSync(dest, markdown)
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

async function main() {
  const reportDir = readInput("report-dir") || readInput("report_dir")
  if (!reportDir) {
    throw new Error("report-dir is required")
  }

  const result = await prepareReports({
    reportDir,
    name: readInput("name") || "HTML Report",
    inlineAssets: isTruthy(readInput("inline-assets"), true),
    redactSecrets: isTruthy(readInput("redact-secrets"), false),
    failOnEmpty: isTruthy(readInput("fail-on-empty"), true),
    publishArchive: isTruthy(readInput("publish-archive"), true),
    tempDir: process.env.RUNNER_TEMP || tmpdir(),
    runUrl: runUrlFromEnv()
  })

  writeStepSummary(result.markdown.replace(/<!--[\s\S]*?-->\n/, ""))
  setOutput("output-dir", result.outputDir)
  setOutput("artifact-name", result.artifactName)
  setOutput("report-count", String(result.reports.length))
  setOutput("failed-count", String(result.failedCount))
  setOutput("empty", result.empty ? "true" : "false")
  setOutput("failed", result.failedCount > 0 ? "true" : "false")
  setOutput("comment-markdown", result.markdown)

  if (result.empty && result.failOnEmpty) {
    throw new Error(`No HTML files found in ${reportDir}`)
  }

  console.log(`Prepared ${result.reports.length} HTML report(s) in ${result.outputDir}`)
}

main().catch((error) => {
  console.error(error && error.message ? error.message : error)
  process.exit(1)
})
