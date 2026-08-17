class Rect {
  constructor (pos, size, attribs) {
    this.pos = pos
    this.size = size
    this.attribs = attribs
  }
}

const binary = operation => (out, left, right) => {
  const x = operation(left[0], right[0])
  const y = operation(left[1], right[1])
  const target = out || left
  target[0] = x
  target[1] = y
  return target
}

const v = {
  add2: binary((a, b) => a + b),
  sub2: binary((a, b) => a - b),
  mul2: binary((a, b) => a * b),
  div2: binary((a, b) => a / b),
  mulN: (out, value, factor) => {
    const target = out || value
    const x = value[0] * factor
    const y = value[1] * factor
    target[0] = x
    target[1] = y
    return target
  },
  copy: value => value.slice()
}

module.exports = { Rect, v }
