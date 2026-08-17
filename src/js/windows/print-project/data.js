// Project data is assembled and containment-checked in the main process.
// The renderer accepts only the already-normalized object returned by the
// print preload API.
const getProjectData = async payload => {
  if (!payload || typeof payload !== 'object') throw new Error('Invalid print project data')
  const project = payload.project
  if (!project || typeof project !== 'object' || !Array.isArray(project.scenes)) {
    throw new Error('The main process did not provide a valid print project')
  }
  return project
}

module.exports = { getProjectData }
