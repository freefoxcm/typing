(function (root) {
  'use strict';
  const tracks = [
    {
      id: 'coast', name: '晴风海岸', english: 'SUNSHINE COAST', theme: 'coast',
      description: '海风刚好，沿着蓝色海岸全速出发。', difficulty: '轻松入门', level: 1,
      width: 16, sky: '#cceced', fog: '#cfeced', ground: '#aacd82', sand: '#f0dfb1', water: '#65c6cf',
      accent: '#f3834b', dark: '#277575', seed: 12,
      points: [[0, 0], [0, 72], [31, 128], [101, 150], [168, 117], [182, 48], [154, -26], [93, -80], [29, -69], [-12, -35]]
    },
    {
      id: 'forest', name: '青森秘境', english: 'FOREST RUN', theme: 'forest',
      description: '穿过松林和溪谷，把每个弯变成主场。', difficulty: '连续弯道', level: 2,
      width: 14, sky: '#d2e5d8', fog: '#cfdfcf', ground: '#699b72', sand: '#c8b797', water: '#77b6b4',
      accent: '#388675', dark: '#25584b', seed: 37,
      points: [[0, 0], [0, 68], [35, 111], [87, 92], [97, 43], [153, 46], [180, 103], [230, 112], [256, 49], [222, -22], [159, -62], [99, -35], [48, -81], [0, -61]]
    },
    {
      id: 'city', name: '落日街区', english: 'SUNSET DISTRICT', theme: 'city',
      description: '城市染上落日，发夹弯等你漂亮甩尾。', difficulty: '高手挑战', level: 3,
      width: 14, sky: '#f3d4bc', fog: '#f0d4bc', ground: '#c5bfb0', sand: '#e4d5bf', water: '#abbec8',
      accent: '#ba715d', dark: '#795747', seed: 86,
      points: [[0, 0], [0, 92], [24, 128], [52, 103], [51, 30], [92, 0], [128, 33], [121, 109], [162, 135], [207, 96], [205, -1], [151, -58], [63, -83], [2, -59]]
    }
  ];
  root.KartTracks = tracks;
  if (typeof module !== 'undefined' && module.exports) module.exports = tracks;
})(typeof globalThis !== 'undefined' ? globalThis : this);
