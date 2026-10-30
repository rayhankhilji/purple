import numpy as np, json, subprocess
SR=44100; TL=json.load(open('timeline.json')); T=TL['total']+0.5; N=int(SR*T); t=np.arange(N)/SR
out=np.zeros(N)
def note(f,start,dur,amp=0.2,kind='pad'):
    i0=int(start*SR); n=int(dur*SR); 
    if i0>=N: return
    n=min(n,N-i0); tt=np.arange(n)/SR
    if kind=='pad':
        env=np.minimum(tt/0.8,1)*np.minimum((dur-tt)/0.8,1); env=np.clip(env,0,1)
        s=sum(np.sin(2*np.pi*f*(1+d)*tt+k) for k,d in enumerate([0,0.003,-0.004]))/3 + 0.3*np.sin(2*np.pi*f*2*tt)
    elif kind=='pluck':
        env=np.exp(-tt*5)*np.minimum(tt/0.005,1)
        s=np.sin(2*np.pi*f*tt)+0.4*np.sin(2*np.pi*f*2*tt)+0.15*np.sin(2*np.pi*f*3*tt)
    elif kind=='bass':
        env=np.minimum(tt/0.02,1)*np.exp(-tt*1.2)
        s=np.sin(2*np.pi*f*tt)+0.2*np.sin(2*np.pi*f*2*tt)
    out[i0:i0+n]+=amp*env*s
def hz(m): return 440*2**((m-69)/12)
bpm=104; beat=60/bpm; bar=4*beat
# progression (C major-ish, hopeful): Cmaj7 Am7 Fmaj7 G(add9)  -> repeat
chords=[[60,64,67,71],[57,60,64,67],[53,57,60,64],[55,59,62,66]]
nb=int(T/bar)+1
for b in range(nb):
    ch=chords[b%4]; st=b*bar
    # dynamics: quiet in note card, build, settle
    lvl=0.35 if st<5 else (0.6 if st<20 else (1.0 if st<105 else 0.7))
    for m in ch: note(hz(m-12),st,bar+0.4,0.045*lvl,'pad')
    note(hz(ch[0]-24),st,bar,0.16*lvl,'bass'); note(hz(ch[0]-24),st+2*beat,bar/2,0.12*lvl,'bass')
    if st>=18:
        arp=[ch[0]+12,ch[1]+12,ch[2]+12,ch[3]+12,ch[2]+12,ch[1]+12,ch[3]+24,ch[2]+12]
        for k in range(16):
            if (b*16+k)%16 in (0,2,3,5,6,8,10,11,13,14): note(hz(arp[k%8]),st+k*beat/4,0.6,0.07*lvl,'pluck')
    if st>=40:
        for k in range(8):  # soft hat
            i0=int((st+k*beat/2)*SR); n=int(0.04*SR)
            if i0+n<N: out[i0:i0+n]+=np.random.randn(n)*np.exp(-np.arange(n)/SR*120)*0.05*lvl*(1 if k%2 else 0.6)
# SFX: whoosh at each section boundary, blips at pins
rng=np.random.default_rng(1)
for s in TL['sections'][1:]:
    i0=int((s['start']-0.4)*SR); n=int(0.9*SR); tt=np.arange(n)/SR
    if i0+n<N:
        env=np.sin(np.pi*tt/0.9)**2; noise=rng.standard_normal(n)
        # crude bandpass via differencing & smoothing
        noise=np.convolve(noise,np.ones(24)/24,mode='same'); out[i0:i0+n]+=noise*env*0.5
def blip(at,f=1320,a=0.09):
    i0=int(at*SR); n=int(0.18*SR); tt=np.arange(n)/SR
    if i0+n<N: out[i0:i0+n]+=a*np.exp(-tt*22)*np.sin(2*np.pi*f*tt*(1+0.3*np.exp(-tt*30)))
sec={s['id']:s['start'] for s in TL['sections']}
for d in [5.5,7,8.2,9.6,11.2]: blip(sec['02_vision']+d)
for d in [2,3.6,5.2,6.8]: blip(sec['03_energy']+d,990)
for d in [1.4,2.3,3.2,4.1]: blip(sec['06_beyond']+d,1180)
# server wake-up hum in problem section
i0=int((sec['01_problem']+2.2)*SR); n=int(7*SR); tt=np.arange(n)/SR
out[i0:i0+n]+=0.06*np.minimum(tt/2,1)*np.minimum((7-tt)/1.5,1)*(np.sin(2*np.pi*55*tt)+0.5*np.sin(2*np.pi*110.5*tt))
# liquid flow in engine section
i0=int((sec['04_engine']+1)*SR); n=int(14*SR)
fl=rng.standard_normal(n); fl=np.convolve(fl,np.ones(80)/80,mode='same'); env=np.minimum(np.arange(n)/SR/1.5,1)*np.minimum((14-np.arange(n)/SR)/1.5,1)
out[i0:i0+n]+=fl*env*0.35*(1+0.3*np.sin(2*np.pi*0.7*np.arange(n)/SR))
# gentle lowpass + limiter
y=np.zeros_like(out); a=0.25
for c in range(2): out=np.convolve(out,np.ones(6)/6,mode='same')
out=np.tanh(out*1.6)*0.6
import wave; w=wave.open('music.wav','wb'); w.setnchannels(1); w.setsampwidth(2); w.setframerate(SR); w.writeframes((out*32767).astype(np.int16).tobytes()); w.close()
print('music ok',T)
