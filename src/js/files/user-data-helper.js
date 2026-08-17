const fs = require('fs')
const { app } = require('electron')
const { resolveInside, resolveForWriteInside } = require('../utils/security')

let prefs
let isLoaded = false
let userDataPath

const init = () => {
  userDataPath = app.getPath('userData')
}

const getData = (filename) => {
  return new Promise((resolve, reject)=>{
    let filepath
    try {
      filepath = resolveInside(userDataPath, filename)
    } catch (error) {
      return reject(error)
    }
    fs.readFile(filepath, (error, file) => {
      if(error) {
        return reject(error)
      }
      let result
      try {
        result = JSON.parse(file)
      } catch(e) {
        return reject(e)
      }
      return resolve(result)
    })
  })
}

const saveData = (filename, data) => {
  return new Promise((resolve, reject)=>{
    let filepath
    try {
      filepath = resolveForWriteInside(userDataPath, filename)
    } catch (error) {
      return reject(error)
    }
    fs.writeFile(filepath, JSON.stringify(data, null, 2), (error)=>{
      if(error) {
        return reject(error)
      }
      return resolve()
    })
  })
}

init()

module.exports = {
  getData,
  saveData,
  init
}
