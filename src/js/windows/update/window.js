const updater = window.storyboarderUpdater

if (updater) {
  updater.onProgress(progress => {
    const percent = Math.floor(progress.percent)
    const bar = document.querySelector('.update-progress_bar')
    const status = document.querySelector('.update-status')
    if (bar) bar.style.width = `${percent}%`
    if (status) status.textContent = `${percent}%`
  })

  updater.onReleaseNotes(releaseNotes => {
    const element = document.querySelector('.update-release-notes')
    // Release notes come from remote update metadata.  Render them as text so
    // a compromised feed cannot execute HTML in the update window.
    if (element) element.textContent = releaseNotes
  })
}
