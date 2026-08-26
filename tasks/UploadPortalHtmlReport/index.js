const tl = require("azure-pipelines-task-lib/task")
const { resolve, join, dirname } = require("path")
const { readFileSync, writeFileSync, mkdirSync, statSync } = require("fs")
const { tmpdir } = require("os")
const {
  findHtmlFiles,
  displayNameFor,
  generateAttachmentName,
  isReportSuccessful,
  redactHtmlDocument,
  inlineLocalAssets,
  createReportArchive
} = require("./lib")

const REPORT_TYPE = "portal.report"
const SUMMARY_TYPE = "portal.summary"
const ARCHIVE_TYPE = "portal.archive"
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

function getBool(name, defaultValue) {
  const raw = tl.getInput(name, false)
  if (raw === undefined || raw === null || raw === "") {
    return defaultValue
  }
  return tl.getBoolInput(name, false)
}

async function run() {
  const reportDir = resolve(tl.getPathInput("reportDir", true, false))
  const tabName = tl.getInput("tabName", false) || "HTML Report"
  const redactSecrets = getBool("redactSecrets", false)
  const failOnEmpty = getBool("failOnEmpty", true)
  const failOnFailedReports = getBool("failOnFailedReports", false)
  const inlineAssets = getBool("inlineAssets", true)
  const publishArchive = getBool("publishArchive", true)

  const reportStats = statSync(reportDir)
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
    let fileContent = readFileSync(file, "utf8")

    if (inlineAssets) {
      const result = inlineLocalAssets(fileContent, file, reportStats.isDirectory() ? reportDir : dirname(file))
      result.warnings.forEach((warning) => tl.warning(warning))
      if (result.inlined.length) {
        tl.debug(`Inlined ${result.inlined.length} asset(s) into ${relativeName}`)
      }
      fileContent = result.html
    }

    const successful = isReportSuccessful(fileContent)
    let outputContent = fileContent

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

  let archiveInfo = null
  if (publishArchive && reportStats.isDirectory()) {
    const archivePath = join(workDir, "html-reports.zip")
    const archiveResult = await createReportArchive(reportDir, archivePath)
    if (archiveResult.skipped) {
      tl.warning(`Skipped report zip (${archiveResult.reason})`)
    } else {
      const archiveName = generateAttachmentName({
        tabName,
        jobName,
        stageName,
        stageAttempt,
        fileName: "html-reports.zip"
      })
      tl.addAttachment(ARCHIVE_TYPE, archiveName, archivePath)
      archiveInfo = {
        name: archiveName,
        type: ARCHIVE_TYPE,
        fileName: "html-reports.zip"
      }
      console.log(`Published zip archive (${archiveResult.files} files, ${archiveResult.bytes} bytes)`)
    }
  }

  const summaryPath = join(workDir, "summary.json")
  const summaryName = generateAttachmentName({
    tabName,
    jobName,
    stageName,
    stageAttempt,
    fileName: "summary.json"
  })
  const summaryPayload = {
    version: 2,
    reports: fileProperties,
    archive: archiveInfo
  }
  writeFileSync(summaryPath, JSON.stringify(summaryPayload, null, 2))
  tl.addAttachment(SUMMARY_TYPE, summaryName, summaryPath)
  console.log(`Published ${fileProperties.length} HTML report(s) to tab "${tabName}"`)

  const failedReports = fileProperties.filter((item) => item.successful === false)
  if (failOnFailedReports && failedReports.length) {
    tl.setResult(
      tl.TaskResult.Failed,
      `${failedReports.length} HTML report(s) contain failed tests`
    )
  }
}

run().catch((error) => {
  tl.error((error && error.message) || String(error))
  if (error && error.stack) {
    tl.debug(error.stack)
  }
  tl.setResult(tl.TaskResult.Failed, (error && error.message) || String(error))
})
