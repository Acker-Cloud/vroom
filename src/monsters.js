/* monsters: creature and boss meshes and their animation. Owner: monsters.
   SCAFFOLD STUB: a red cone per actor. The monsters builder models every kind in
   VROOM.monsterAI.KINDS (docs/OVERHAUL.md "Monsters"), animated from ActorState.state / stateT / phase. */

function build(ctx, kind) {
  const T = ctx.THREE, K = (VROOM.monsterAI.KINDS[kind]) || { r: 1, h: 2 };
  const group = new T.Group();
  const body = new T.Mesh(new T.ConeGeometry(K.r, K.h, 6), new T.MeshStandardMaterial({ color: 0xb3200f, flatShading: true }));
  body.position.y = K.h / 2;
  group.add(body);
  return {
    group,
    update(a, dt, t) { body.rotation.y = t * 2; group.visible = a.alive && a.state !== 'gone'; },
    onEvent(what) {},
    dispose() { body.geometry.dispose(); body.material.dispose(); },
  };
}

VROOM.monsters = { build };
