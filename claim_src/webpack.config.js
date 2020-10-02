const path = require('path');
var webpack = require('webpack');

module.exports = {
    plugins: [
      new webpack.ProvidePlugin({
        '$': 'jquery',
        '_': 'lodash'
      })
    ],
  entry: './index.js',
  output: {
    filename: 'claim.js',
    path: path.join(__dirname, '..', 'js'),
  },
  mode: 'development',
  devtool: "source-map"
};