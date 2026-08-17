module.exports = { composeWithStateSync: (...enhancers) => {
  if (enhancers.length === 1) return enhancers[0]
  return (...args) => enhancers.reduce((acc, enhancer) => enhancer(acc), args[0])
} }
