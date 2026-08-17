const execa = require('execa')
const fs = require('fs-extra')
const path = require('path')
const { resolveInside, resolveForWriteInside } = require('../utils/security')
const dayjs = require('dayjs')
const tmp = require('tmp')
const os = require('os')

const reportedFfmpegPath = require('ffmpeg-static')

// via https://github.com/sindresorhus/electron-util/blob/main/source/is-using-asar.js
const isUsingAsar = () => {
  // ffmpeg-static points into app.asar in packaged builds.  The binary is
  // unpacked by electron-builder, so no renderer access to remote.process is
  // needed to determine the executable path.
  return typeof reportedFfmpegPath === 'string' && reportedFfmpegPath.includes('app.asar')
}

let ffmpegPath = reportedFfmpegPath
if (isUsingAsar()) {
  ffmpegPath = reportedFfmpegPath.replace('app.asar', 'app.asar.unpacked')
}

const boardModel = require('../models/board')
const exporterCommon = require('../exporters/common')
const { safeFilename } = require('../utils/security')

// const durationRegex = /Duration: (\d\d:\d\d:\d\d.\d\d)/gm
// const frameRegex = /frame=\s+(\d+)/gm

// via https://github.com/sindresorhus/slash/blob/master/index.js
const slash = input => {
	const isExtendedLengthPath = /^\\\\\?\\/.test(input)
	const hasNonAscii = /[^\u0000-\u0080]+/.test(input)

	if (isExtendedLengthPath || hasNonAscii) {
		return input
	}

	return input.replace(/\\/g, '/')
}

const checkVersion = async () =>
  new Promise((resolve, reject) => {
    let matchedVersion

    console.log('Checking for ffmpeg at', ffmpegPath)
    const process = execa(ffmpegPath, [
      '-version'
    ])
    process.stdout.on('data', data => {
      data = data.toString().trim()
      const matchesVersion = data.match(/^ffmpeg version (\S+)/)
      if (matchesVersion) {
        matchedVersion = matchesVersion[1]
      }
    })
    process.on('error', reject)
    process.on('exit', code => {
      if (code === 0) {
        resolve(matchedVersion)
      } else {
        reject(new Error(`Could not use ffmpeg. Failed with error ${code}`))
      }
    })
    process.catch(reject)
  })

// via https://github.com/wulkano/kap/blob/5769d76587/app/src/scripts/convert.js
const convert = async (opts, args) =>
  new Promise((resolve, reject) => {
    const converter = execa(ffmpegPath, args)
    // let amountOfFrames

    converter.stderr.on('data', data => {
      data = data.toString().trim()

      //
      // FIXME this doesn't work because ffmpeg doesn't report the correct Duration
      //         actual Duration would be Input #0's Duration (the ffconcat stream)
      //          OR, the time + duration of the final audio
      //           (whichever is greater)
      //
      // const matchesDuration = durationRegex.exec(data)
      // const matchesFrame = frameRegex.exec(data)
      //
      // if (matchesDuration) {
      //   amountOfFrames = Math.ceil(moment.duration(matchesDuration[1]).asSeconds() * 30)
      // } else if (matchesFrame) {
      //   const currentFrame = matchesFrame[1]
      //   opts.progressCallback(currentFrame / amountOfFrames)
      // }

      // for debugging
      console.log(data)
    })
    converter.on('error', reject)
    converter.on('exit', code => {
      if (code === 0) {
        resolve(true)
      } else {
        reject(new Error(`Could not use ffmpeg. Failed with error ${code}`))
      }
    })
    converter.catch(reject)
  })

const convertToVideo = async opts => {
  const { outputPath, sceneFilePath, scene } = opts

  let tmpDir = tmp.dirSync()
  let outputFilePath
  try {
		let shouldWatermark = opts.shouldWatermark

    // copy the watermark
    console.log('copying required resources …')
    fs.copySync(
      opts.watermarkImagePath,
      path.join(tmpDir.name, 'watermark.png')
    )

    // export flattened boards to output path
    console.log('exporting images and audio for output …')
    let writers = scene.boards.map(async (board, index) =>
      exporterCommon.exportFlattenedBoard(
        board,
        safeFilename(board.url, `board-${index + 1}.png`),
        boardModel.boardFileImageSize(scene),
        sceneFilePath,
        tmpDir.name
      )
    )
    await Promise.all(writers)

    let streamOffset = shouldWatermark
			? 2 // video + watermark
			: 1 // video only

    const FADE_OUT_IN_SECONDS = 0.25

    let audioFilterComplex
    let audioFileArgs = []
    let audioFilters = []
    let audioStreamIndex = 0
    for (let board of scene.boards) {
      if (board.audio) {
        let audioPath
        try {
          audioPath = resolveInside(path.join(path.dirname(sceneFilePath), 'images'), board.audio.filename)
        } catch (err) {
          console.warn(`Skipping invalid project audio path: ${board.audio.filename}`)
          continue
        }
        audioFileArgs = audioFileArgs.concat([
          '-i', audioPath
        ])

        // lol via https://video.stackexchange.com/a/22115
        // let fadeout = `areverse, afade=d=0.5, areverse`
        // related: audio-playback.js FADE_OUT_IN_SECONDS
        let fadeout = `areverse, afade=d=${FADE_OUT_IN_SECONDS}:curve=exp, areverse`

        const boardTime = Number.isFinite(Number(board.time))
          ? Math.max(0, Math.min(24 * 60 * 60 * 1000, Number(board.time)))
          : 0
        let filter = boardTime > 0
          ? `${fadeout},adelay=${boardTime}|${boardTime}`
          : `${fadeout}`

        // stream index
        let n = audioStreamIndex + streamOffset
        audioFilters.push(`[${n}]${filter}[s${n}]`)

        audioStreamIndex++
      }
    }

    if (audioFileArgs.length) {
      let mixout = ';'
      for (let i = 0; i < audioFilters.length; i++) {
        mixout += `[s${i + streamOffset}]`
      }
      mixout += `amix=${audioFilters.length}[mix]`

      audioFilterComplex = audioFilters.join(';') + mixout
    }

    // TODO write ffconcat to tmp folder

    // generate the ffconcat image sequencer file
    // add last board twice because ffmpeg ¯\_(ツ)_/¯
    let boardsWithLastBoardTwice = scene.boards.concat(scene.boards[scene.boards.length - 1])
    let videoConcats = ['ffconcat version 1.0']
    for (let [index, board] of boardsWithLastBoardTwice.entries()) {
      const duration = Number(boardModel.boardDuration(scene, board))
      let durationInSeconds = Number.isFinite(duration)
        ? Math.max(0.001, Math.min(24 * 60 * 60, duration / 1000))
        : 2
      let filename = safeFilename(board.url, `board-${(index % scene.boards.length) + 1}.png`)
      videoConcats.push('')
      // via https://superuser.com/questions/718027/ffmpeg-concat-doesnt-work-with-absolute-path
      // > use forward slashes, not backslashes, even in Windows
      videoConcats.push(`file ${slash(resolveInside(tmpDir.name, filename))}`)
      videoConcats.push(`duration ${durationInSeconds}`)
    }

    console.log('\n')
    console.log('writing video.ffconcat')
    console.log(videoConcats.join('\n'))
    const concatFilePath = resolveForWriteInside(tmpDir.name, 'video.ffconcat')
    fs.writeFileSync(concatFilePath, videoConcats.join('\n'))
    console.log('\n')

    console.log('\n')
    outputFilePath = resolveForWriteInside(outputPath, `${path.basename(sceneFilePath, path.extname(sceneFilePath))} Exported ${dayjs().format('YYYY-MM-DD hh.mm.ss')}.mp4`)
    console.log('writing to', outputFilePath)
    console.log('\n')

    let args = [
      // accept any filename for ffconcat
      '-safe', '0',

      // Input #0
      '-i', concatFilePath,

      // Input #1
      ...(shouldWatermark ? ['-i', path.join(tmpDir.name, 'watermark.png')] : [])
    ]

    args = args.concat(audioFileArgs)

    // TODO operate in tmp folder but write to exports folder

    args = args.concat([
      '-filter_complex',
			[
                          // via https://stackoverflow.com/a/20848224
                          // fixes "width not divisible by 2"
                          '[0]scale=-2:900[frame]',

													...(shouldWatermark
                          	? [
																// input #1 = watermark
																// scaled to 1/8th, don't re-scale below 255 px
																// see: https://superuser.com/a/567934
																// see: https://trac.ffmpeg.org/wiki/Scaling#AvoidingUpscaling
																`[1]scale=-2:'min(225,ih)':force_original_aspect_ratio=decrease[watermark]`,
																// overlay watermark w/ shorthand positioning
																'[frame][watermark]overlay=W-w:H-h[vid]'
															]
														: [
																// frame = vid
																'[frame]null[vid]'
															]
													),

                          // use audio (if present) or route silence to mix
                          ...(audioFilterComplex
                            ? [audioFilterComplex]
                            : [])
			].join(';'),
      '-map', '[vid]:v'
    ])

    args = args.concat([
      '-r', Number.isFinite(Number(scene.fps)) && Number(scene.fps) >= 1 && Number(scene.fps) <= 120
        ? Number(scene.fps)
        : 24,
      '-vcodec', 'libx264',
      '-acodec', 'aac',

      // via https://trac.ffmpeg.org/wiki/Encode/H.264
      // QuickTime only supports YUV planar color space with 4:2:0 chroma subsampling (use -vf format=yuv420p or -pix_fmt yuv420p) for H.264 video.
      '-pix_fmt', 'yuv420p',

      // TODO tweak settings for best output
      // via https://trac.ffmpeg.org/wiki/Encode/H.264
      '-tune', 'stillimage',
      '-preset', 'veryslow'

      // via https://medium.com/@forasoft/the-grip-of-ffmpeg-4b05d7f7678c
      // '-b:v', '700k',

      // '-b:a', '128k',
      // '-ar', '44100',
    ])

    // mix audio only if we have at least 1 audio input file
    if (audioFileArgs.length) {
      args = args.concat([
        '-map', '[mix]:a'
      ])
    }

    args = args.concat([
      // via https://uart.cz/1570/simple-animation-with-ffmpeg/
      // The -movflags +faststart parameters will move some media informations to
      // the beginning of file, which allows browser to start video even before it
      // was completely downloaded from the server.
      '-movflags', '+faststart',

      // don't overwriting existing file
      '-n',

      '-stats',

      outputFilePath
    ])

    console.log('calling ffmpeg with args', args)
    console.log('\n')

    // debugging directory listing
    // console.log('\n')
    // console.log(`tree ${outputPath}:`)
    // let result = await execa('tree', [ outputPath ])
    // console.log(result.stdout)
    // console.log('\n')

    // opts.progressCallback(0)
    await convert(opts, args)

    // TODO cleanup PNG files

    console.log('ffmpeg complete!')
  } finally {
    // cleanup
    console.log('cleaning', tmpDir.name)
    fs.emptyDirSync(tmpDir.name)
    tmpDir.removeCallback()
  }
  return outputFilePath
}

module.exports = {
  checkVersion,
  convertToVideo,
  convert
}
