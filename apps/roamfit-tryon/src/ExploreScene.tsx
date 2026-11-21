import { Canvas } from '@react-three/fiber'
import { ContactShadows, Float, OrbitControls, RoundedBox } from '@react-three/drei'
import type { Outfit } from './types'

function Palm({ x, z, scale=1 }:{x:number;z:number;scale?:number}) {
  return <group position={[x,0,z]} scale={scale}>
    <mesh position={[0,1.15,0]} rotation={[0,0,-.08]}><cylinderGeometry args={[.09,.14,2.3,9]}/><meshStandardMaterial color="#9a6245"/></mesh>
    {[0,1,2,3,4,5].map(i=><mesh key={i} position={[0,2.25,0]} rotation={[0,i*Math.PI/3,.75]}><capsuleGeometry args={[.1,1.5,4,8]}/><meshStandardMaterial color="#2b755d"/></mesh>)}
  </group>
}

function Avatar({ outfit }:{outfit:Outfit}) {
  return <Float speed={1.1} rotationIntensity={.04} floatIntensity={.08}>
    <group position={[0,-.2,0]}>
      <mesh position={[0,2.75,0]} castShadow><sphereGeometry args={[.32,32,32]}/><meshStandardMaterial color="#7d4c35" roughness={.8}/></mesh>
      <mesh position={[0,2.92,-.06]} castShadow><sphereGeometry args={[.34,24,24,0,Math.PI*2,0,1.5]}/><meshStandardMaterial color="#191b20"/></mesh>
      <RoundedBox args={[.9,1.25,.48]} radius={.18} position={[0,1.9,0]} castShadow><meshStandardMaterial color={outfit.colors.top}/></RoundedBox>
      <mesh position={[-.57,1.86,0]} rotation={[0,0,-.08]} castShadow><capsuleGeometry args={[.11,1.1,8,16]}/><meshStandardMaterial color="#8f5b42"/></mesh>
      <mesh position={[.57,1.86,0]} rotation={[0,0,.08]} castShadow><capsuleGeometry args={[.11,1.1,8,16]}/><meshStandardMaterial color="#8f5b42"/></mesh>
      <mesh position={[-.23,.78,0]} castShadow><capsuleGeometry args={[.17,1.45,8,16]}/><meshStandardMaterial color={outfit.colors.bottom}/></mesh>
      <mesh position={[.23,.78,0]} castShadow><capsuleGeometry args={[.17,1.45,8,16]}/><meshStandardMaterial color={outfit.colors.bottom}/></mesh>
      <mesh position={[0,1.33,.28]} castShadow><torusGeometry args={[.37,.055,12,32]}/><meshStandardMaterial color={outfit.colors.accent} metalness={.4}/></mesh>
    </group>
  </Float>
}

export function ExploreScene({ outfit }:{outfit:Outfit}) {
  return <Canvas shadows camera={{position:[4,2.8,7],fov:34}} dpr={[1,1.5]}>
    <color attach="background" args={['#87cbd4']}/><fog attach="fog" args={['#87cbd4',9,18]}/>
    <ambientLight intensity={1.3}/><directionalLight position={[4,7,5]} intensity={2.4} castShadow/>
    <mesh position={[0,-1.05,0]} receiveShadow><cylinderGeometry args={[4.8,5.2,.35,64]}/><meshStandardMaterial color="#eac993"/></mesh>
    <mesh position={[0,-1.2,-4]}><boxGeometry args={[20,.2,8]}/><meshStandardMaterial color="#308fa1" roughness={.3}/></mesh>
    <Palm x={-2.6} z={-1.4} scale={.9}/><Palm x={2.9} z={-2.2} scale={.7}/>
    <Avatar outfit={outfit}/><ContactShadows position={[0,-.86,0]} opacity={.45} scale={5} blur={2.5}/>
    <OrbitControls enablePan={false} minDistance={5} maxDistance={10} minPolarAngle={Math.PI/3.4} maxPolarAngle={Math.PI/2.05}/>
  </Canvas>
}
