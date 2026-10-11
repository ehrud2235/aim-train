// 바인드 연습 설정: 시작 위치, 각 잡기 자리, 1:1 자리.
// 맵 모양·높이·위치 이름·텔레포터는 실제 게임 데이터로 만든 maps/bind.grid.gz 에 들어 있다 (tools/build-bind.mjs).
// 좌표: 미니맵을 위에서 본 평면, 단위 m. x = 오른쪽(동), y = 위(북). 미니맵처럼 공격팀이 아래, A 가 오른쪽, B 가 왼쪽.
// heading: 나침반 각도 (0 = 북/미니맵 위, 90 = 동/오른쪽, 180 = 남, 270 = 서)

export const BIND = {
  name: 'Bind',
  label: '바인드',
  grid: 'maps/bind.grid.gz',

  spawns: {
    attacker: { at: [98.5, 13.5], heading: 0 },
    defender: { at: [87.5, 151], heading: 180 },
  },

  // 각 잡기: 내 자리·방향만 정하면, 봇이 숨었다 튀어나오는 모서리는 실제 지형에서 자동으로 찾는다 (spots.js)
  holds: [
    { id: 'aSiteLamps', label: 'A 사이트 → 램프 쪽 (수비)', at: [120, 108.5], heading: 280 },
    { id: 'aTowerSite', label: 'A 타워(헤븐) 발코니 → A 사이트 (수비)', at: [131, 127.5], heading: 195, maxDist: 45 },
    { id: 'aShortPush', label: 'A 숏 (공격) → 커비·텔레포터·램프', at: [104, 80], heading: 0 },
    { id: 'aLobbyBath', label: 'A 로비 (공격) → A 바스', at: [133, 70], heading: 15 },
    { id: 'aBathSite', label: 'A 바스 출구 (공격) → A 사이트', at: [140, 99], heading: 300 },
    { id: 'bSiteHookah', label: 'B 사이트 → 후카 창문 (수비)', at: [42, 126], heading: 145 },
    { id: 'bElbowGarden', label: 'B 사이트 엘보 쪽 → 가든 (수비)', at: [36, 112], heading: 160 },
    { id: 'bLongPush', label: 'B 롱 (공격) → 가든·텔레포터', at: [33, 66], heading: 0 },
    { id: 'hookahSite', label: '후카 창문 (공격) → B 사이트', at: [53, 109], heading: 330 },
    { id: 'defSpawnA', label: '수비 스폰 → A 링크 쪽 (리테이크)', at: [95, 140], heading: 150 },
  ],

  // 1:1 스트레이프 봇: 내 자리·방향·거리 → 시선과 수직으로 좌우 움직일 수 있는 곳을 자동으로 고름
  duels: [
    { id: 'bLong25', label: 'B 롱 25m', at: [33, 64], heading: 0, dist: 25, span: 2 },
    { id: 'aSite15', label: 'A 사이트 15m', at: [114, 107], heading: 85, dist: 15, span: 2 },
    { id: 'aLobby20', label: 'A 로비 20m', at: [125, 63], heading: 50, dist: 20, span: 2 },
    { id: 'bSite12', label: 'B 사이트 12m', at: [36.5, 112], heading: 60, dist: 12, span: 2 },
    { id: 'bHall15', label: 'B 홀 15m', at: [45, 136], heading: 100, dist: 15, span: 2 },
    { id: 'link10', label: '링크 10m', at: [76, 69], heading: 90, dist: 10, span: 1.5 },
  ],
};
