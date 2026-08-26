import "./tabContent.scss"

import * as React from "react"
import * as ReactDOM from "react-dom"
import * as SDK from "azure-devops-extension-sdk"

import { getClient } from "azure-devops-extension-api"
import { ReleaseEnvironment, ReleaseRestClient, ReleaseTaskAttachment } from "azure-devops-extension-api/Release"
import { Build, BuildRestClient, Attachment } from "azure-devops-extension-api/Build"
import { CommonServiceIds, IProjectPageService } from "azure-devops-extension-api"

import { ObservableValue, ObservableObject } from "azure-devops-ui/Core/Observable"
import { Observer } from "azure-devops-ui/Observer"
import { Tab, TabBar, TabSize } from "azure-devops-ui/Tabs"
import { Card } from "azure-devops-ui/Card"
import { Button } from "azure-devops-ui/Button"
import { IHeaderCommandBarItem } from "azure-devops-ui/HeaderCommandBar"

const ATTACHMENT_TYPE = "portal.summary"
const REPORT_ATTACHMENT_TYPE = "portal.report"
const ARCHIVE_ATTACHMENT_TYPE = "portal.archive"
const OUR_TASK_IDS = [
  "4d9a74ab-346a-4549-936a-6a3d3ad77227"
]

interface AttachmentNameParts {
  tabName: string
  jobName: string
  stageName: string
  stageAttempt: string
  fileName: string
}

function parseAttachmentName(name: string): AttachmentNameParts {
  const delimiter = name.indexOf("~") >= 0 ? "~" : "."
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

function parseSummaryPayload(payload: any): { reports: any[], archive: any } {
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

function toBase64(value: string): string {
  return btoa(value)
}

function triggerBlobDownload(blob: Blob, fileName: string) {
  const url = URL.createObjectURL(blob)
  const link = document.createElement("a")
  link.href = url
  link.download = fileName
  document.body.appendChild(link)
  link.click()
  document.body.removeChild(link)
  URL.revokeObjectURL(url)
}

SDK.init()
SDK.ready().then(() => {
  try {
    const config = SDK.getConfiguration()
    if (typeof config.onBuildChanged === "function") {
      config.onBuildChanged((build: Build) => {
        const buildAttachmentClient = new BuildAttachmentClient(build)
        buildAttachmentClient.init().then(() => {
          displayReports(buildAttachmentClient)
        }).catch((error) => { setError(error) })
      })
    } else if (typeof config.releaseEnvironment === "object") {
      const releaseAttachmentClient = new ReleaseAttachmentClient(config.releaseEnvironment)
      releaseAttachmentClient.init().then(() => {
        displayReports(releaseAttachmentClient)
      }).catch((error) => { setError(error) })
    }
  } catch (error) {
    setError(error)
  }
})

function setText(message: string) {
  console.log(message)
  const messageContainer = document.querySelector("#portal-ext-message p")
  if (messageContainer) {
    messageContainer.textContent = message
  }
}

function setError(error: Error) {
  setText("Error loading reports")
  console.log(error)
  const spinner = document.querySelector(".spinner") as HTMLElement
  const errorBadge = document.querySelector(".error-badge") as HTMLElement
  if (spinner) {
    spinner.style.display = "none"
  }
  if (errorBadge) {
    errorBadge.style.display = "block"
  }
}

function displayReports(attachmentClient: AttachmentClient) {
  const nbAttachments = attachmentClient.getAttachments().length
  if (nbAttachments) {
    ReactDOM.render(<TaskAttachmentPanel attachmentClient={attachmentClient} />, document.getElementById("portal-ext-container"))
    const message = document.getElementById("portal-ext-message")
    if (message) {
      message.style.display = "none"
    }
    SDK.notifyLoadSucceeded()
  } else {
    setError(Error("Could not find any report attachment"))
  }
}

SDK.register("registerBuild", {
  isInvisible: function () {
    return false
  }
})

SDK.register("registerRelease", {
  isInvisible: function (state) {
    const resultArray = []
    const environment = state && state.releaseEnvironment
    if (!(environment && environment.deployPhasesSnapshot)) {
      return true
    }
    environment.deployPhasesSnapshot.forEach((phase) => {
      (phase.workflowTasks || []).forEach((task) => {
        resultArray.push(task.taskId)
      })
    })
    return !OUR_TASK_IDS.some((id) => resultArray.indexOf(id) >= 0)
  }
})

interface ReportProps {
  successful: boolean
  name: string
  fileName: string
  href: string
}

interface ArchiveProps {
  name: string
  fileName: string
  href: string
}

interface SummaryResult {
  reports: ReportProps[]
  archive: ArchiveProps
}

interface ReportCardProps {
  attachmentClient: AttachmentClient
  report: ReportProps
  startExpanded?: boolean
}

class ReportCard extends React.Component<ReportCardProps> {
  private collapsed = new ObservableValue<boolean>(true)
  private initialContent = "<p>Loading...</p>"
  private content = new ObservableValue<string>(this.initialContent)
  private commandBarItems: IHeaderCommandBarItem[]
  private objectUrl: string = null

  constructor(props: ReportCardProps) {
    super(props)
    this.collapsed = new ObservableValue(!props.startExpanded)
    this.commandBarItems = [
      {
        important: true,
        id: "Download",
        text: "Download",
        iconProps: {
          iconName: "Download"
        },
        onActivate: () => { this.downloadReport() }
      }
    ]
  }

  public componentDidMount() {
    if (this.props.startExpanded) {
      this.loadReport()
    }
  }

  public componentWillUnmount() {
    if (this.objectUrl) {
      URL.revokeObjectURL(this.objectUrl)
    }
  }

  public render() {
    const parsed = parseAttachmentName(this.props.report.name)
    const reportName = this.props.report.fileName || parsed.fileName || this.props.report.name
    return (
      <Card
        className={"flex-grow " + (this.props.report.successful ? "card-success" : "card-failure")}
        collapsible={true}
        collapsed={this.collapsed}
        onCollapseClick={this.onCollapseClicked}
        titleProps={{ text: reportName }}
        headerIconProps={{ iconName: this.props.report.successful ? "SkypeCircleCheck" : "StatusErrorFull" }}
        headerCommandBarItems={this.commandBarItems}>

        <Observer content={this.content}>
          {(props: { content: string }) => {
            return <span className="full-size" dangerouslySetInnerHTML={{ __html: props.content }} />
          }}
        </Observer>
      </Card>
    )
  }

  private downloadReport = () => {
    this.props.attachmentClient.download(this.props.report.href).then((report) => {
      triggerBlobDownload(new Blob([report], { type: "text/html" }), this.props.report.fileName || "report.html")
    }).catch((err) => {
      console.error(err)
    })
  }

  private loadReport = () => {
    if (this.content.value != this.initialContent) {
      return
    }
    this.props.attachmentClient.download(this.props.report.href).then((report) => {
      if (this.objectUrl) {
        URL.revokeObjectURL(this.objectUrl)
      }
      const blob = new Blob([report], { type: "text/html" })
      this.objectUrl = URL.createObjectURL(blob)
      this.content.value = '<iframe class="full-size" sandbox="allow-scripts allow-same-origin allow-popups allow-forms" src="' + this.objectUrl + '"></iframe>'
    }).catch((err) => {
      this.content.value = "<p>" + String(err).replace(/[&<>'"]/g, "") + "</p>"
    })
  }

  private onCollapseClicked = () => {
    this.collapsed.value = !this.collapsed.value
    if (!this.collapsed.value) {
      this.loadReport()
    }
  }
}

interface TaskAttachmentPanelProps {
  attachmentClient: AttachmentClient
}

export default class TaskAttachmentPanel extends React.Component<TaskAttachmentPanelProps> {
  private selectedTabId: ObservableValue<string>
  private tabContents: ObservableObject<JSX.Element>
  private tabInitialContent: JSX.Element = <div className="wide"><p>Loading...</p></div>

  constructor(props: TaskAttachmentPanelProps) {
    super(props)
    this.selectedTabId = new ObservableValue(props.attachmentClient.getAttachments()[0].name)
    this.tabContents = new ObservableObject()
  }

  public render() {
    const attachments = this.props.attachmentClient.getAttachments()
    if (attachments.length == 0) {
      return (null)
    } else {
      const tabs = []
      const tabNameCount: { [name: string]: number } = {}
      attachments.forEach((attachment) => {
        const parsed = parseAttachmentName(attachment.name)
        tabNameCount[parsed.tabName] = 1 + (tabNameCount[parsed.tabName] || 0)
      })
      for (const attachment of attachments) {
        const parsed = parseAttachmentName(attachment.name)
        const name = (parsed.stageName && parsed.stageName !== "__default" && tabNameCount[parsed.tabName] > 1)
          ? `${parsed.tabName} #${parsed.stageAttempt}`
          : parsed.tabName

        tabs.push(<Tab name={name} id={attachment.name} key={attachment.name} />)
        this.tabContents.add(attachment.name, this.tabInitialContent)
      }
      return (
        <div className="flex-column">
          {attachments.length > 1 ?
            <TabBar
              onSelectedTabChanged={this.onSelectedTabChanged}
              selectedTabId={this.selectedTabId}
              tabSize={TabSize.Tall}>
              {tabs}
            </TabBar>
          : null}
          <Observer selectedTabId={this.selectedTabId} tabContents={this.tabContents}>
            {(props: { selectedTabId: string }) => {
              if (this.tabContents.get(props.selectedTabId) === this.tabInitialContent) {
                this.props.attachmentClient.getReportSummary(props.selectedTabId).then((summary) => {
                  const cards = []
                  const startExpanded = summary.reports.length === 1
                  for (const reportData of summary.reports) {
                    const cardProps: ReportCardProps = {
                      report: reportData,
                      attachmentClient: this.props.attachmentClient,
                      startExpanded
                    }
                    cards.push(<ReportCard {...cardProps} key={reportData.name} />)
                  }
                  const content = (
                    <div className="flex-column" style={{ flexWrap: "nowrap" }}>
                      {summary.archive ?
                        <div className="archive-bar">
                          <Button
                            text="Download all"
                            iconProps={{ iconName: "Download" }}
                            onClick={() => this.downloadArchive(summary.archive)}
                          />
                        </div>
                      : null}
                      {cards}
                    </div>
                  )
                  this.tabContents.set(props.selectedTabId, content)
                }).catch((error) => {
                  this.tabContents.set(props.selectedTabId, <div className="wide"><p>Error loading report:<br />{String(error)}</p></div>)
                  setError(error)
                })
              }
              return this.tabContents.get(props.selectedTabId)
            }}
          </Observer>
        </div>
      )
    }
  }

  private downloadArchive = (archive: ArchiveProps) => {
    this.props.attachmentClient.downloadBinary(archive.href).then((blob) => {
      triggerBlobDownload(blob, archive.fileName || "html-reports.zip")
    }).catch((err) => {
      console.error(err)
    })
  }

  private onSelectedTabChanged = (newTabId: string) => {
    this.selectedTabId.value = newTabId
  }
}

abstract class AttachmentClient {
  protected attachments: (Attachment | ReleaseTaskAttachment)[] = []
  protected authHeaders: { [header: string]: string } = undefined

  abstract async init(): Promise<void>
  abstract async getAttachmentsOfType(type: string): Promise<(Attachment | ReleaseTaskAttachment)[]>

  public getAttachments(): (Attachment | ReleaseTaskAttachment)[] {
    return this.attachments
  }

  private async getAuthHeaders(): Promise<{ [header: string]: string }> {
    if (this.authHeaders === undefined) {
      const accessToken = await SDK.getAccessToken()
      this.authHeaders = { "Authorization": "Basic " + toBase64(":" + accessToken) }
    }
    return this.authHeaders
  }

  public async download(href: string): Promise<string> {
    const response = await fetch(href, { headers: await this.getAuthHeaders() })
    if (!response.ok) {
      throw new Error(response.statusText)
    }
    return await response.text()
  }

  public async downloadBinary(href: string): Promise<Blob> {
    const response = await fetch(href, { headers: await this.getAuthHeaders() })
    if (!response.ok) {
      throw new Error(response.statusText)
    }
    return await response.blob()
  }

  public getDownloadableAttachment(attachmentName: string): Attachment | ReleaseTaskAttachment {
    const attachment = this.attachments.find((item) => item.name === attachmentName)
    if (!(attachment && attachment._links && attachment._links.self && attachment._links.self.href)) {
      throw new Error("Attachment " + attachmentName + " is not downloadable")
    }
    return attachment
  }

  public async getReportAttachments(): Promise<(Attachment | ReleaseTaskAttachment)[]> {
    return this.getAttachmentsOfType(REPORT_ATTACHMENT_TYPE)
  }

  public async getReportSummary(attachmentName: string): Promise<SummaryResult> {
    setText("Looking for Summary File")
    const attachment = this.getDownloadableAttachment(attachmentName)
    const payload = parseSummaryPayload(JSON.parse(await this.download(attachment._links.self.href)))
    setText("Processing Summary File")
    const reports = await this.getAttachmentsOfType(REPORT_ATTACHMENT_TYPE)
    const archives = await this.getAttachmentsOfType(ARCHIVE_ATTACHMENT_TYPE)
    const mappedReports = payload.reports.map((report) => {
      const rp = reports.find((item) => item.name === report.name)
      const parsed = parseAttachmentName(report.name)
      const href = rp && rp._links && rp._links.self && rp._links.self.href
      return {
        successful: report.successful !== undefined ? report.successful : report.successfull,
        name: report.name,
        fileName: report.fileName || parsed.fileName,
        href
      }
    }).filter((report) => !!report.href)

    let archive: ArchiveProps = null
    if (payload.archive && payload.archive.name) {
      const match = archives.find((item) => item.name === payload.archive.name)
      if (match && match._links && match._links.self && match._links.self.href) {
        archive = {
          name: payload.archive.name,
          fileName: payload.archive.fileName || "html-reports.zip",
          href: match._links.self.href
        }
      }
    }

    return { reports: mappedReports, archive }
  }
}

class BuildAttachmentClient extends AttachmentClient {
  private build: Build

  constructor(build: Build) {
    super()
    this.build = build
  }

  public async init() {
    const buildClient: BuildRestClient = getClient(BuildRestClient)
    this.attachments = await buildClient.getAttachments(this.build.project.id, this.build.id, ATTACHMENT_TYPE)
  }

  public async getAttachmentsOfType(type: string): Promise<Attachment[]> {
    const buildClient: BuildRestClient = getClient(BuildRestClient)
    return await buildClient.getAttachments(this.build.project.id, this.build.id, type)
  }
}

class ReleaseAttachmentClient extends AttachmentClient {
  private releaseEnvironment: ReleaseEnvironment
  private projectId: string
  private deployStepAttempt: number
  private runPlanIds: string[] = []

  constructor(releaseEnvironment: ReleaseEnvironment) {
    super()
    this.releaseEnvironment = releaseEnvironment
  }

  public async init() {
    const releaseId = this.releaseEnvironment.releaseId
    const environmentId = this.releaseEnvironment.id
    const projectService = await SDK.getService<IProjectPageService>(CommonServiceIds.ProjectPageService)
    const project = await projectService.getProject()
    const releaseClient: ReleaseRestClient = getClient(ReleaseRestClient)
    const release = await releaseClient.getRelease(project.id, releaseId)
    const env = release.environments.filter((item) => item.id === environmentId)[0]

    if (!(env.deploySteps && env.deploySteps.length)) {
      throw new Error("This release has not been deployed yet")
    }

    const deployStep = env.deploySteps[env.deploySteps.length - 1]
    if (!(deployStep.releaseDeployPhases && deployStep.releaseDeployPhases.length)) {
      throw new Error("This release has no job")
    }

    const matchingPlanIds: string[] = []
    const allPlanIds: string[] = []
    for (const phase of deployStep.releaseDeployPhases) {
      if (phase.runPlanId) {
        allPlanIds.push(phase.runPlanId)
      }
      for (const deploymentJob of phase.deploymentJobs || []) {
        for (const task of deploymentJob.tasks || []) {
          if (task.task && OUR_TASK_IDS.indexOf(task.task.id) >= 0 && phase.runPlanId) {
            if (matchingPlanIds.indexOf(phase.runPlanId) === -1) {
              matchingPlanIds.push(phase.runPlanId)
            }
          }
        }
      }
    }

    this.runPlanIds = matchingPlanIds.length ? matchingPlanIds : allPlanIds
    if (!this.runPlanIds.length) {
      throw new Error("There are no plan IDs")
    }

    this.projectId = project.id
    this.deployStepAttempt = deployStep.attempt
    this.attachments = []
    for (const planId of this.runPlanIds) {
      const planAttachments = await releaseClient.getReleaseTaskAttachments(
        project.id,
        releaseId,
        environmentId,
        deployStep.attempt,
        planId,
        ATTACHMENT_TYPE
      )
      this.attachments = this.attachments.concat(planAttachments)
    }
    if (this.attachments.length === 0) {
      throw new Error("There is no attachment")
    }
  }

  public async getAttachmentsOfType(type: string): Promise<ReleaseTaskAttachment[]> {
    const releaseClient: ReleaseRestClient = getClient(ReleaseRestClient)
    let results: ReleaseTaskAttachment[] = []
    for (const planId of this.runPlanIds) {
      const planReports = await releaseClient.getReleaseTaskAttachments(
        this.projectId,
        this.releaseEnvironment.releaseId,
        this.releaseEnvironment.id,
        this.deployStepAttempt,
        planId,
        type
      )
      results = results.concat(planReports)
    }
    return results
  }
}
