const tl = require("azure-pipelines-task-lib/task")
const { resolve, join } = require("path")
const { readFileSync, writeFileSync, mkdirSync, statSync } = require("fs")
const { tmpdir } = require("os")
const {
  findHtmlFiles,
  displayNameFor,
  generateAttachmentName,
  isReportSuccessful,
  redactHtmlDocument
} = require("./lib")

const REPORT_TYPE = "portal.report"
const SUMMARY_TYPE = "portal.summary"
const MAX_REDACT_BYTES = 5 * 1024 * 1024

function getTempWorkDir() {
  const base = tl.getVariable("Agent.TempDirectory") || tmpdir()
  const dir = join(base, "html-report-portal", String(Date.now()))
  mkdirSync(dir, { recursive: true })
  return dir
}

function uniqueOutputPath(workDir, relativeName) {
  return join(workDir, relativeName.replace(/[\\/]/g, "_"))
}

function run() {
  const reportDir = resolve(tl.getPathInput("reportDir", true, false))
  const tabName = tl.getInput("tabName", false) || "HTML Report"
  const redactSecrets = tl.getBoolInput("redactSecrets", false)
  const failOnEmpty = tl.getBoolInput("failOnEmpty", false)

  statSync(reportDir)

  const files = findHtmlFiles(reportDir)
  if (files.length === 0) {
    const message = `No HTML files found in ${reportDir}`
    if (failOnEmpty) {
      tl.setResult(tl.TaskResult.Failed, message)
    } else {
      tl.warning(message)
    }
    return
  }

  const workDir = getTempWorkDir()
  const jobName = tl.getVariable("Agent.JobName")
  const stageName = tl.getVariable("System.StageDisplayName")
  const stageAttempt = tl.getVariable("System.StageAttempt")
  const fileProperties = []

  files.forEach((file) => {
    const relativeName = displayNameFor(file, reportDir)
    tl.debug(`Reading report ${file}`)
    const fileContent = readFileSync(file, "utf8")
    let outputContent = fileContent
    const successful = isReportSuccessful(fileContent)

    if (redactSecrets) {
      const bytes = Buffer.byteLength(fileContent, "utf8")
      if (bytes > MAX_REDACT_BYTES) {
        tl.warning(
          `Skipping secret redaction for ${relativeName} (${bytes} bytes); file is too large to parse safely.`
        )
      } else {
        const { load } = require("cheerio")
        const document = load(fileContent)
        redactHtmlDocument(document)
        outputContent = document.html()
      }
    }

    const attachmentName = generateAttachmentName({
      tabName,
      jobName,
      stageName,
      stageAttempt,
      fileName: relativeName
    })
    const outPath = uniqueOutputPath(workDir, relativeName)
    writeFileSync(outPath, outputContent)

    fileProperties.push({
      name: attachmentName,
      type: REPORT_TYPE,
      successful,
      fileName: relativeName
    })
    tl.addAttachment(REPORT_TYPE, attachmentName, outPath)
    tl.debug(`Uploaded ${relativeName} as ${attachmentName}`)
  })

  const summaryPath = join(workDir, "summary.json")
  const summaryName = generateAttachmentName({
    tabName,
    jobName,
    stageName,
    stageAttempt,
    fileName: "summary.json"
  })
  writeFileSync(summaryPath, JSON.stringify(fileProperties, null, 2))
  tl.addAttachment(SUMMARY_TYPE, summaryName, summaryPath)
  console.log(`Published ${fileProperties.length} HTML report(s) to tab "${tabName}"`)
}

try {
  run()
} catch (error) {
  tl.error((error && error.message) || String(error))
  if (error && error.stack) {
    tl.debug(error.stack)
  }
  tl.setResult(tl.TaskResult.Failed, (error && error.message) || String(error))
}
