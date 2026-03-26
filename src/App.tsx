/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect, useRef } from 'react';
import { 
  Shield, 
  MapPin, 
  Bell, 
  Calendar, 
  GraduationCap, 
  User, 
  AlertTriangle,
  ChevronRight,
  Clock,
  CheckCircle2,
  XCircle,
  LogIn,
  UserPlus,
  Mic,
  MicOff,
  Video,
  VideoOff,
  PhoneOff
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import socket from './lib/socket';
import { api } from './lib/api';

// --- Types ---
type Role = 'parent' | 'teacher' | 'child';

interface UserData {
  id: string;
  name: string;
  role: Role;
  token: string;
}

interface LogEntry {
  id: number;
  child_id: string;
  type: 'attendance' | 'grade' | 'behavior';
  status: string;
  timestamp: string;
  category: string;
}

interface CalendarEvent {
  id: number;
  title: string;
  description: string;
  start_time: string;
  type: 'school_event' | 'sports_match' | 'summons';
  target_role: string;
}

export default function App() {
  const [user, setUser] = useState<UserData | null>(null);
  const [isAuthMode, setIsAuthMode] = useState<'login' | 'register'>('login');
  const [authForm, setAuthForm] = useState({ email: '', password: '', name: '', role: 'parent' as Role });
  const [isSOSActive, setIsSOSActive] = useState(false);
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [events, setEvents] = useState<CalendarEvent[]>([]);
  const [locationHistory, setLocationHistory] = useState<any[]>([]);
  const [familyChildren, setFamilyChildren] = useState<any[]>([]);
  const [analytics, setAnalytics] = useState<any>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [showAddLog, setShowAddLog] = useState(false);
  const [showAddEvent, setShowAddEvent] = useState(false);
  const [showLinkChild, setShowLinkChild] = useState(false);
  const [showVideoCall, setShowVideoCall] = useState(false);
  const [childEmailToLink, setChildEmailToLink] = useState('');
  const [newLog, setNewLog] = useState({ type: 'attendance' as any, status: '', category: 'School' });
  const [newEvent, setNewEvent] = useState({ title: '', description: '', start_time: '', type: 'school_event' as any, target_role: 'all' });

  // WebRTC Refs & State
  const localVideoRef = useRef<HTMLVideoElement>(null);
  const remoteVideoRef = useRef<HTMLVideoElement>(null);
  const peerConnection = useRef<RTCPeerConnection | null>(null);
  const [localStream, setLocalStream] = useState<MediaStream | null>(null);
  const [isMicOn, setIsMicOn] = useState(true);
  const [isVideoOn, setIsVideoOn] = useState(true);
  const [pendingOffer, setPendingOffer] = useState<{ offer: RTCSessionDescriptionInit, senderId: string } | null>(null);

  const configuration = {
    iceServers: [
      { urls: 'stun:stun.l.google.com:19302' },
      { urls: 'stun:stun1.l.google.com:19302' },
    ],
  };

  useEffect(() => {
    if (user) {
      socket.on('connect', () => console.log('Connected to safety server'));
      socket.on(`sos_alert_${user.id}`, (data) => {
        setIsSOSActive(true);
      });

      socket.on(`webrtc_signal_${user.id}`, async (data) => {
        const { signal, senderId } = data;
        
        if (signal.type === 'offer') {
          await handleOffer(signal, senderId);
        } else if (signal.type === 'answer') {
          await handleAnswer(signal);
        } else if (signal.candidate) {
          await handleIceCandidate(signal);
        }
      });

      fetchLogs();
      fetchEvents();
      fetchLocationHistory();
      fetchFamilyData();
      fetchAnalytics();
    }
    return () => {
      socket.off(`sos_alert_${user?.id}`);
      socket.off(`webrtc_signal_${user?.id}`);
    };
  }, [user]);

  const setupPeerConnection = (targetId: string, stream: MediaStream) => {
    const pc = new RTCPeerConnection(configuration);
    
    pc.onicecandidate = (event) => {
      if (event.candidate) {
        socket.emit('webrtc_signal', {
          targetId,
          senderId: user?.id,
          signal: event.candidate
        });
      }
    };

    pc.ontrack = (event) => {
      if (remoteVideoRef.current) {
        remoteVideoRef.current.srcObject = event.streams[0];
      }
    };

    stream.getTracks().forEach(track => {
      pc.addTrack(track, stream);
    });

    peerConnection.current = pc;
    return pc;
  };

  const startCall = async (targetId: string) => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
      setLocalStream(stream);
      if (localVideoRef.current) localVideoRef.current.srcObject = stream;

      const pc = setupPeerConnection(targetId, stream);
      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);

      socket.emit('webrtc_signal', {
        targetId,
        senderId: user?.id,
        signal: offer
      });
      setShowVideoCall(true);
    } catch (err) {
      console.error('Error starting call:', err);
    }
  };

  const handleOffer = async (offer: RTCSessionDescriptionInit, senderId: string) => {
    setPendingOffer({ offer, senderId });
    setIsSOSActive(true);
  };

  const joinCall = async () => {
    if (!pendingOffer) return;
    const { offer, senderId } = pendingOffer;
    
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
      setLocalStream(stream);
      if (localVideoRef.current) localVideoRef.current.srcObject = stream;

      const pc = setupPeerConnection(senderId, stream);
      await pc.setRemoteDescription(new RTCSessionDescription(offer));
      const answer = await pc.createAnswer();
      await pc.setLocalDescription(answer);

      socket.emit('webrtc_signal', {
        targetId: senderId,
        senderId: user?.id,
        signal: answer
      });
      
      setShowVideoCall(true);
    } catch (err) {
      console.error('Error joining call:', err);
    }
  };

  const handleAnswer = async (answer: RTCSessionDescriptionInit) => {
    if (peerConnection.current) {
      await peerConnection.current.setRemoteDescription(new RTCSessionDescription(answer));
    }
  };

  const handleIceCandidate = async (candidate: RTCIceCandidateInit) => {
    if (peerConnection.current) {
      try {
        await peerConnection.current.addIceCandidate(new RTCIceCandidate(candidate));
      } catch (e) {
        console.error('Error adding ice candidate', e);
      }
    }
  };

  const endCall = () => {
    if (localStream) {
      localStream.getTracks().forEach(track => track.stop());
    }
    if (peerConnection.current) {
      peerConnection.current.close();
      peerConnection.current = null;
    }
    setLocalStream(null);
    setPendingOffer(null);
    setShowVideoCall(false);
    setIsSOSActive(false);
  };

  const toggleMic = () => {
    if (localStream) {
      localStream.getAudioTracks().forEach(track => track.enabled = !isMicOn);
      setIsMicOn(!isMicOn);
    }
  };

  const toggleVideo = () => {
    if (localStream) {
      localStream.getVideoTracks().forEach(track => track.enabled = !isVideoOn);
      setIsVideoOn(!isVideoOn);
    }
  };

  const fetchLogs = async () => {
    if (!user) return;
    try {
      const data = await api.get(`/logs/child_123`, user.token);
      setLogs(data);
    } catch (err) {
      console.error(err);
    }
  };

  const fetchEvents = async () => {
    if (!user) return;
    try {
      const data = await api.get(`/calendar`, user.token);
      setEvents(data);
    } catch (err) {
      console.error(err);
    }
  };

  const fetchLocationHistory = async () => {
    if (!user) return;
    try {
      const data = await api.get(`/locations/child_123`, user.token);
      setLocationHistory(data);
    } catch (err) {
      console.error(err);
    }
  };

  const fetchFamilyData = async () => {
    if (!user || (user.role !== 'parent' && user.role !== 'family')) return;
    try {
      const data = await api.get('/family/children', user.token);
      setFamilyChildren(data);
    } catch (err) {
      console.error(err);
    }
  };

  const fetchAnalytics = async () => {
    if (!user) return;
    try {
      const data = await api.get('/analytics/child_123', user.token);
      setAnalytics(data);
    } catch (err) {
      console.error(err);
    }
  };

  const handleLinkChild = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user) return;
    try {
      await api.post('/family/link', { childEmail: childEmailToLink }, user.token);
      setShowLinkChild(false);
      setChildEmailToLink('');
      fetchFamilyData();
      alert('Child linked successfully!');
    } catch (err: any) {
      alert(err.message || 'Failed to link child');
    }
  };

  const handleAddLog = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user) return;
    try {
      await api.post('/logs', { ...newLog, childId: 'child_123' }, user.token);
      setShowAddLog(false);
      setNewLog({ type: 'attendance', status: '', category: 'School' });
      fetchLogs();
    } catch (err) {
      console.error(err);
    }
  };

  const handleAddEvent = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user) return;
    try {
      await api.post('/calendar', newEvent, user.token);
      setShowAddEvent(false);
      setNewEvent({ title: '', description: '', start_time: '', type: 'school_event', target_role: 'all' });
      fetchEvents();
    } catch (err) {
      console.error(err);
    }
  };

  const handleAuth = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError('');
    try {
      if (isAuthMode === 'login') {
        const data = await api.post('/auth/login', { email: authForm.email, password: authForm.password });
        setUser({ ...data.user, token: data.token });
      } else {
        await api.post('/auth/register', authForm);
        setIsAuthMode('login');
        alert('Registration successful! Please login.');
      }
    } catch (err: any) {
      setError(err.message || 'Authentication failed');
    } finally {
      setLoading(false);
    }
  };

  const triggerSOS = () => {
    if (!user) return;
    socket.emit('trigger_sos', { childId: user.id, parentId: 'parent_456' }); // Mock parent ID
    setIsSOSActive(true);
    startCall('parent_456');
  };

  if (!user) {
    return (
      <div className="min-h-screen bg-[#F7F9FC] flex items-center justify-center p-6">
        <motion.div 
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          className="bg-white p-8 rounded-3xl shadow-xl w-full max-w-md border border-[#E1E2E6]"
        >
          <div className="flex flex-col items-center mb-8">
            <div className="w-16 h-16 bg-[#005FB8] rounded-2xl flex items-center justify-center text-white mb-4 shadow-lg">
              <Shield size={32} />
            </div>
            <h1 className="text-2xl font-bold text-[#1A1C1E]">ChildSafety Hub</h1>
            <p className="text-[#74777F] text-sm">Secure Coordination for Families</p>
          </div>

          <form onSubmit={handleAuth} className="space-y-4">
            {isAuthMode === 'register' && (
              <input
                type="text"
                placeholder="Full Name"
                className="w-full p-4 bg-[#F0F4F8] rounded-xl border-none focus:ring-2 focus:ring-[#005FB8]"
                value={authForm.name}
                onChange={e => setAuthForm({ ...authForm, name: e.target.value })}
                required
              />
            )}
            <input
              type="email"
              placeholder="Email Address"
              className="w-full p-4 bg-[#F0F4F8] rounded-xl border-none focus:ring-2 focus:ring-[#005FB8]"
              value={authForm.email}
              onChange={e => setAuthForm({ ...authForm, email: e.target.value })}
              required
            />
            <input
              type="password"
              placeholder="Password"
              className="w-full p-4 bg-[#F0F4F8] rounded-xl border-none focus:ring-2 focus:ring-[#005FB8]"
              value={authForm.password}
              onChange={e => setAuthForm({ ...authForm, password: e.target.value })}
              required
            />
            {isAuthMode === 'register' && (
              <select 
                className="w-full p-4 bg-[#F0F4F8] rounded-xl border-none focus:ring-2 focus:ring-[#005FB8]"
                value={authForm.role}
                onChange={e => setAuthForm({ ...authForm, role: e.target.value as Role })}
              >
                <option value="parent">Parent</option>
                <option value="teacher">Teacher</option>
                <option value="child">Child</option>
              </select>
            )}
            
            {error && <p className="text-[#BA1A1A] text-xs font-bold text-center">{error}</p>}

            <button 
              disabled={loading}
              className="w-full py-4 bg-[#005FB8] text-white rounded-xl font-bold shadow-lg hover:bg-[#004A8F] transition-all flex items-center justify-center gap-2"
            >
              {loading ? 'Processing...' : isAuthMode === 'login' ? <><LogIn size={20}/> Login</> : <><UserPlus size={20}/> Register</>}
            </button>
          </form>

          <div className="mt-6 text-center">
            <button 
              onClick={() => setIsAuthMode(isAuthMode === 'login' ? 'register' : 'login')}
              className="text-[#005FB8] text-sm font-bold hover:underline"
            >
              {isAuthMode === 'login' ? "Don't have an account? Register" : "Already have an account? Login"}
            </button>
          </div>
        </motion.div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#F7F9FC] text-[#1A1C1E] font-sans">
      <header className="bg-white border-b border-[#E1E2E6] px-6 py-4 flex items-center justify-between sticky top-0 z-50">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 bg-[#005FB8] rounded-xl flex items-center justify-center text-white">
            <Shield size={24} />
          </div>
          <div>
            <h1 className="text-lg font-bold tracking-tight text-[#1A1C1E]">ChildSafety</h1>
            <p className="text-[10px] text-[#74777F] font-bold uppercase tracking-widest">Coordination Hub</p>
          </div>
        </div>

        <div className="flex items-center gap-4">
          <div className="hidden md:flex items-center gap-2 px-4 py-2 bg-[#EFF1F5] rounded-xl">
            <span className="text-xs font-bold text-[#44474E] uppercase tracking-wider">{user.role}</span>
          </div>
          <button className="w-10 h-10 rounded-full bg-[#EFF1F5] flex items-center justify-center text-[#44474E]">
            <Bell size={20} />
          </button>
          <button 
            onClick={() => setUser(null)}
            className="w-10 h-10 rounded-full bg-[#D1E4FF] flex items-center justify-center text-[#001D36] font-bold hover:bg-[#BA1A1A] hover:text-white transition-all"
          >
            {user.name.charAt(0).toUpperCase()}
          </button>
        </div>
      </header>

      <main className="max-w-7xl mx-auto p-6 grid grid-cols-1 lg:grid-cols-12 gap-6">
        
        {/* Left Column: Safety & Tracking */}
        <section className="lg:col-span-4 space-y-6">
          <div className="bg-white rounded-3xl p-6 shadow-sm border border-[#E1E2E6]">
            <div className="flex items-center justify-between mb-6">
              <h2 className="text-xl font-bold flex items-center gap-2">
                <MapPin size={22} className="text-[#005FB8]" />
                Live Tracking
              </h2>
              <span className="px-3 py-1 bg-[#D1E4FF] text-[#001D36] text-[10px] font-bold rounded-full">ACTIVE</span>
            </div>
            
            <div className="aspect-square bg-[#EFF1F5] rounded-2xl relative overflow-hidden mb-4 flex items-center justify-center border border-[#E1E2E6]">
              <div className="absolute inset-0 opacity-20 bg-[radial-gradient(#005FB8_1px,transparent_1px)] [background-size:20px_20px]"></div>
              <div className="relative">
                <div className="w-12 h-12 bg-[#005FB8]/20 rounded-full animate-ping absolute -inset-0"></div>
                <div className="w-12 h-12 bg-[#005FB8] rounded-full flex items-center justify-center text-white relative shadow-lg">
                  <User size={24} />
                </div>
              </div>
              <div className="absolute bottom-4 left-4 right-4 bg-white/90 backdrop-blur-md p-3 rounded-xl border border-[#E1E2E6]">
                <p className="text-sm font-bold">Ahmed is at School</p>
                <p className="text-[10px] text-[#74777F]">Last updated: 2 mins ago</p>
              </div>
            </div>

            {user.role === 'child' ? (
              <button 
                onClick={triggerSOS}
                className={`w-full py-4 rounded-2xl flex items-center justify-center gap-3 font-bold text-lg transition-all shadow-lg ${
                  isSOSActive ? 'bg-[#BA1A1A] text-white animate-pulse' : 'bg-[#BA1A1A] text-white hover:bg-[#93000A]'
                }`}
              >
                <AlertTriangle size={24} />
                {isSOSActive ? 'SOS ACTIVE' : 'TRIGGER SOS'}
              </button>
            ) : (
              <div className="space-y-3">
                <button className="w-full py-3 bg-[#005FB8] text-white rounded-xl font-bold flex items-center justify-center gap-2">
                  <MapPin size={18} /> View History
                </button>
                <button className="w-full py-3 border border-[#005FB8] text-[#005FB8] rounded-xl font-bold flex items-center justify-center gap-2">
                  Set Safe Zone
                </button>
              </div>
            )}
          </div>

          <AnimatePresence>
            {isSOSActive && user.role !== 'child' && (
              <motion.div 
                initial={{ opacity: 0, scale: 0.9 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 0.9 }}
                className="bg-[#FFDAD6] border-2 border-[#BA1A1A] rounded-3xl p-6 shadow-2xl"
              >
                <div className="flex items-start gap-4">
                  <div className="bg-[#BA1A1A] p-3 rounded-full text-white animate-bounce shrink-0">
                    <AlertTriangle size={24} />
                  </div>
                  <div className="flex-1">
                    <h3 className="text-[#410002] font-black text-lg">EMERGENCY ALERT</h3>
                    <p className="text-[#410002] text-sm mb-4">Ahmed triggered an SOS from School. Visual assessment required.</p>
                    <div className="flex gap-2">
                      <button 
                        onClick={joinCall}
                        className="flex-1 bg-[#BA1A1A] text-white py-2 rounded-lg font-bold text-sm"
                      >
                        Join Video Call
                      </button>
                      <button 
                        onClick={() => setIsSOSActive(false)}
                        className="px-4 py-2 border border-[#BA1A1A] text-[#BA1A1A] rounded-lg font-bold text-sm"
                      >
                        Dismiss
                      </button>
                    </div>
                  </div>
                </div>
              </motion.div>
            )}
          </AnimatePresence>

          {/* Video Call Modal */}
          <AnimatePresence>
            {showVideoCall && (
              <motion.div 
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                className="fixed inset-0 bg-black z-[200] flex flex-col"
              >
                <div className="flex-1 relative flex items-center justify-center overflow-hidden">
                  {/* Remote Video (Full Screen) */}
                  <video 
                    ref={remoteVideoRef}
                    autoPlay 
                    playsInline 
                    className="w-full h-full object-cover"
                  />
                  
                  {!localStream && (
                    <div className="absolute inset-0 flex items-center justify-center text-white text-center bg-black/40 backdrop-blur-sm">
                      <div>
                        <div className="w-24 h-24 bg-[#BA1A1A] rounded-full mx-auto mb-4 flex items-center justify-center animate-pulse">
                          <User size={48} />
                        </div>
                        <h2 className="text-2xl font-bold">Connecting...</h2>
                        <p className="opacity-60">Establishing Secure Video Link</p>
                      </div>
                    </div>
                  )}

                  {/* Local Video (Mini View) */}
                  <div className="absolute bottom-24 right-6 w-32 h-48 bg-gray-900 rounded-2xl border-2 border-white/20 overflow-hidden shadow-2xl">
                    <video 
                      ref={localVideoRef}
                      autoPlay 
                      playsInline 
                      muted 
                      className="w-full h-full object-cover"
                    />
                    {!isVideoOn && (
                      <div className="absolute inset-0 flex items-center justify-center bg-gray-800 text-white/20">
                        <VideoOff size={24} />
                      </div>
                    )}
                  </div>

                  {/* Call Info Overlay */}
                  <div className="absolute top-10 left-10 text-white drop-shadow-lg">
                    <div className="flex items-center gap-3 mb-2">
                      <div className="w-3 h-3 bg-red-500 rounded-full animate-pulse"></div>
                      <span className="font-bold tracking-widest text-xs uppercase">Live SOS Feed</span>
                    </div>
                    <h2 className="text-2xl font-bold">{user.role === 'child' ? 'Parent' : 'Ahmed'}</h2>
                  </div>
                </div>

                {/* Call Controls */}
                <div className="p-10 flex justify-center gap-6 bg-gradient-to-t from-black/90 via-black/40 to-transparent">
                  <button 
                    onClick={toggleMic}
                    className={`w-14 h-14 rounded-full flex items-center justify-center transition-all ${
                      isMicOn ? 'bg-white/10 text-white hover:bg-white/20' : 'bg-red-500 text-white'
                    }`}
                  >
                    {isMicOn ? <Mic size={24} /> : <MicOff size={24} />}
                  </button>
                  
                  <button 
                    onClick={endCall}
                    className="w-16 h-16 bg-[#BA1A1A] rounded-full flex items-center justify-center text-white shadow-xl hover:scale-110 transition-transform"
                  >
                    <PhoneOff size={32} />
                  </button>

                  <button 
                    onClick={toggleVideo}
                    className={`w-14 h-14 rounded-full flex items-center justify-center transition-all ${
                      isVideoOn ? 'bg-white/10 text-white hover:bg-white/20' : 'bg-red-500 text-white'
                    }`}
                  >
                    {isVideoOn ? <Video size={24} /> : <VideoOff size={24} />}
                  </button>
                </div>
              </motion.div>
            )}
          </AnimatePresence>

          {/* Link Child Modal */}
          <AnimatePresence>
            {showLinkChild && (
              <motion.div 
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                className="fixed inset-0 bg-black/50 backdrop-blur-sm z-[100] flex items-center justify-center p-6"
              >
                <motion.div 
                  initial={{ scale: 0.9, y: 20 }}
                  animate={{ scale: 1, y: 0 }}
                  className="bg-white p-8 rounded-3xl shadow-2xl w-full max-w-md border border-[#E1E2E6]"
                >
                  <h3 className="text-xl font-bold mb-6">Link a Child Account</h3>
                  <p className="text-sm text-[#74777F] mb-6">Enter the email address of your child's account to link them to your family dashboard.</p>
                  <form onSubmit={handleLinkChild} className="space-y-4">
                    <input
                      type="email"
                      placeholder="Child's Email Address"
                      className="w-full p-4 bg-[#F0F4F8] rounded-xl border-none"
                      value={childEmailToLink}
                      onChange={e => setChildEmailToLink(e.target.value)}
                      required
                    />
                    <div className="flex gap-3 mt-6">
                      <button type="submit" className="flex-1 py-3 bg-[#005FB8] text-white rounded-xl font-bold">Link Child</button>
                      <button type="button" onClick={() => setShowLinkChild(false)} className="px-6 py-3 bg-[#EFF1F5] text-[#44474E] rounded-xl font-bold">Cancel</button>
                    </div>
                  </form>
                </motion.div>
              </motion.div>
            )}
          </AnimatePresence>

          {/* Location History List */}
          <div className="bg-white rounded-3xl p-6 shadow-sm border border-[#E1E2E6]">
            <h3 className="font-bold text-sm mb-4 flex items-center gap-2">
              <Clock size={16} /> Location History
            </h3>
            <div className="space-y-3 max-h-48 overflow-y-auto pr-2 custom-scrollbar">
              {locationHistory.length > 0 ? locationHistory.map((loc, i) => (
                <div key={i} className="flex items-center justify-between text-xs p-2 bg-[#F0F4F8] rounded-lg">
                  <span className="font-medium text-[#44474E]">
                    {new Date(loc.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                  </span>
                  <span className="text-[#74777F]">{loc.latitude.toFixed(4)}, {loc.longitude.toFixed(4)}</span>
                </div>
              )) : (
                <p className="text-xs text-[#74777F] text-center">No history available.</p>
              )}
            </div>
          </div>
        </section>

        {/* Middle Column: Educational Progress */}
        <section className="lg:col-span-5 space-y-6">
          <div className="bg-white rounded-3xl p-6 shadow-sm border border-[#E1E2E6]">
            <div className="flex items-center justify-between mb-6">
              <h2 className="text-xl font-bold flex items-center gap-2">
                <GraduationCap size={22} className="text-[#005FB8]" />
                Educational Progress
              </h2>
              {user.role === 'teacher' && (
                <button 
                  onClick={() => setShowAddLog(true)}
                  className="text-sm font-bold text-[#005FB8] hover:underline"
                >
                  + Add Log
                </button>
              )}
            </div>

            <AnimatePresence>
              {showAddLog && (
                <motion.div 
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  className="fixed inset-0 bg-black/50 backdrop-blur-sm z-[100] flex items-center justify-center p-6"
                >
                  <motion.div 
                    initial={{ scale: 0.9, y: 20 }}
                    animate={{ scale: 1, y: 0 }}
                    className="bg-white p-8 rounded-3xl shadow-2xl w-full max-w-md border border-[#E1E2E6]"
                  >
                    <h3 className="text-xl font-bold mb-6">Add Educational Log</h3>
                    <form onSubmit={handleAddLog} className="space-y-4">
                      <select 
                        className="w-full p-4 bg-[#F0F4F8] rounded-xl border-none"
                        value={newLog.category}
                        onChange={e => setNewLog({ ...newLog, category: e.target.value })}
                      >
                        <option value="School">School</option>
                        <option value="Sports">Sports</option>
                        <option value="Quran">Quran</option>
                      </select>
                      <select 
                        className="w-full p-4 bg-[#F0F4F8] rounded-xl border-none"
                        value={newLog.type}
                        onChange={e => setNewLog({ ...newLog, type: e.target.value as any })}
                      >
                        <option value="attendance">Attendance</option>
                        <option value="grade">Grade</option>
                        <option value="behavior">Behavior</option>
                      </select>
                      <input
                        type="text"
                        placeholder="Status (e.g., Present, A+, Excellent)"
                        className="w-full p-4 bg-[#F0F4F8] rounded-xl border-none"
                        value={newLog.status}
                        onChange={e => setNewLog({ ...newLog, status: e.target.value })}
                        required
                      />
                      <div className="flex gap-3 mt-6">
                        <button 
                          type="submit"
                          className="flex-1 py-3 bg-[#005FB8] text-white rounded-xl font-bold"
                        >
                          Save Log
                        </button>
                        <button 
                          type="button"
                          onClick={() => setShowAddLog(false)}
                          className="px-6 py-3 bg-[#EFF1F5] text-[#44474E] rounded-xl font-bold"
                        >
                          Cancel
                        </button>
                      </div>
                    </form>
                  </motion.div>
                </motion.div>
              )}
            </AnimatePresence>

            <div className="space-y-4">
              {logs.length > 0 ? logs.map((log) => (
                <div key={log.id} className="flex items-center gap-4 p-4 bg-[#F0F4F8] rounded-2xl group hover:bg-[#E1E9F4] transition-colors cursor-pointer">
                  <div className={`w-12 h-12 rounded-xl flex items-center justify-center text-white shadow-sm shrink-0 ${
                    log.type === 'attendance' ? 'bg-[#006A6A]' : 
                    log.type === 'grade' ? 'bg-[#005FB8]' : 'bg-[#6750A4]'
                  }`}>
                    {log.type === 'attendance' ? <Clock size={20} /> : 
                     log.type === 'grade' ? <CheckCircle2 size={20} /> : <User size={20} />}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center justify-between">
                      <h4 className="font-bold text-sm truncate">{log.category} {log.type.charAt(0).toUpperCase() + log.type.slice(1)}</h4>
                      <span className="text-[10px] font-bold text-[#74777F] uppercase tracking-wider shrink-0">
                        {new Date(log.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                      </span>
                    </div>
                    <p className="text-sm text-[#44474E]">
                      Status: <span className="font-bold text-[#005FB8]">{log.status}</span>
                    </p>
                  </div>
                  <ChevronRight size={18} className="text-[#74777F] group-hover:translate-x-1 transition-transform shrink-0" />
                </div>
              )) : (
                <div className="text-center py-8 text-[#74777F]">
                  <p className="text-sm">No logs found for today.</p>
                </div>
              )}
            </div>

            {/* Analytics Summary */}
            {analytics && (
              <div className="mt-8 pt-8 border-t border-[#E1E2E6]">
                <h3 className="font-bold text-sm mb-4">Educational Analytics</h3>
                <div className="grid grid-cols-3 gap-3">
                  {analytics.stats.map((stat: any) => (
                    <div key={stat.type} className="bg-[#F0F4F8] p-3 rounded-xl text-center">
                      <p className="text-[10px] font-bold text-[#74777F] uppercase">{stat.type}</p>
                      <p className="text-xl font-black text-[#005FB8]">{stat.count}</p>
                    </div>
                  ))}
                </div>
              </div>
            )}

            <button className="w-full mt-6 py-3 bg-[#EFF1F5] text-[#44474E] rounded-xl font-bold text-sm hover:bg-[#E1E2E6] transition-colors">
              View Full Report
            </button>
          </div>

          <div className="bg-[#001D36] rounded-3xl p-6 text-white shadow-lg relative overflow-hidden">
            <div className="relative z-10">
              <h3 className="text-lg font-bold mb-2">Absence Justification</h3>
              <p className="text-sm text-[#D1E4FF] mb-4 opacity-80">Submit official documents for school absences directly to teachers.</p>
              <button className="bg-[#D1E4FF] text-[#001D36] px-6 py-2.5 rounded-xl font-bold text-sm hover:bg-white transition-colors">
                Upload Document
              </button>
            </div>
            <div className="absolute top-0 right-0 w-32 h-32 bg-[#005FB8] rounded-full blur-3xl opacity-20 -mr-16 -mt-16"></div>
          </div>
        </section>

        {/* Right Column: Coordination Calendar */}
        <section className="lg:col-span-3 space-y-6">
          <div className="bg-white rounded-3xl p-6 shadow-sm border border-[#E1E2E6]">
            <div className="flex items-center justify-between mb-6">
              <h2 className="text-xl font-bold flex items-center gap-2">
                <Calendar size={22} className="text-[#005FB8]" />
                Coordination
              </h2>
              {user.role !== 'child' && (
                <button 
                  onClick={() => setShowAddEvent(true)}
                  className="text-sm font-bold text-[#005FB8] hover:underline"
                >
                  + Add
                </button>
              )}
            </div>

            <AnimatePresence>
              {showAddEvent && (
                <motion.div 
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  className="fixed inset-0 bg-black/50 backdrop-blur-sm z-[100] flex items-center justify-center p-6"
                >
                  <motion.div 
                    initial={{ scale: 0.9, y: 20 }}
                    animate={{ scale: 1, y: 0 }}
                    className="bg-white p-8 rounded-3xl shadow-2xl w-full max-w-md border border-[#E1E2E6]"
                  >
                    <h3 className="text-xl font-bold mb-6">Add Calendar Event</h3>
                    <form onSubmit={handleAddEvent} className="space-y-4">
                      <input
                        type="text"
                        placeholder="Event Title"
                        className="w-full p-4 bg-[#F0F4F8] rounded-xl border-none"
                        value={newEvent.title}
                        onChange={e => setNewEvent({ ...newEvent, title: e.target.value })}
                        required
                      />
                      <textarea
                        placeholder="Description"
                        className="w-full p-4 bg-[#F0F4F8] rounded-xl border-none h-24"
                        value={newEvent.description}
                        onChange={e => setNewEvent({ ...newEvent, description: e.target.value })}
                      />
                      <input
                        type="datetime-local"
                        className="w-full p-4 bg-[#F0F4F8] rounded-xl border-none"
                        value={newEvent.start_time}
                        onChange={e => setNewEvent({ ...newEvent, start_time: e.target.value })}
                        required
                      />
                      <select 
                        className="w-full p-4 bg-[#F0F4F8] rounded-xl border-none"
                        value={newEvent.type}
                        onChange={e => setNewEvent({ ...newEvent, type: e.target.value as any })}
                      >
                        <option value="school_event">School Event</option>
                        <option value="sports_match">Sports Match</option>
                        <option value="summons">Official Summons</option>
                      </select>
                      <div className="flex gap-3 mt-6">
                        <button type="submit" className="flex-1 py-3 bg-[#005FB8] text-white rounded-xl font-bold">Save Event</button>
                        <button type="button" onClick={() => setShowAddEvent(false)} className="px-6 py-3 bg-[#EFF1F5] text-[#44474E] rounded-xl font-bold">Cancel</button>
                      </div>
                    </form>
                  </motion.div>
                </motion.div>
              )}
            </AnimatePresence>

            <div className="space-y-6">
              {events.length > 0 ? events.map((event) => (
                <div key={event.id} className="relative pl-6 border-l-2 border-[#D1E4FF]">
                  <div className={`absolute -left-[9px] top-0 w-4 h-4 rounded-full border-4 border-white ${
                    event.type === 'summons' ? 'bg-[#BA1A1A]' : 'bg-[#005FB8]'
                  }`}></div>
                  <p className={`text-[10px] font-bold uppercase mb-1 ${
                    event.type === 'summons' ? 'text-[#BA1A1A]' : 'text-[#005FB8]'
                  }`}>
                    {new Date(event.start_time).toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}
                  </p>
                  <h4 className="font-bold text-sm">{event.title}</h4>
                  {event.description && <p className="text-xs text-[#74777F]">{event.description}</p>}
                </div>
              )) : (
                <div className="text-center py-4 text-[#74777F]">
                  <p className="text-xs">No upcoming events.</p>
                </div>
              )}
            </div>

            <button className="w-full mt-8 py-3 bg-[#005FB8] text-white rounded-xl font-bold text-sm hover:bg-[#004A8F] transition-colors">
              Open Full Calendar
            </button>
          </div>

          <div className="bg-[#E6E1E5] rounded-3xl p-6 border border-[#CAC4D0]">
            <div className="flex items-center justify-between mb-4">
              <h3 className="font-bold text-sm flex items-center gap-2">
                <User size={16} /> Extended Family
              </h3>
              {user.role === 'parent' && (
                <button 
                  onClick={() => setShowLinkChild(true)}
                  className="text-[10px] font-bold text-[#005FB8] hover:underline"
                >
                  + Link Child
                </button>
              )}
            </div>
            <div className="flex -space-x-2 mb-4">
              {familyChildren.length > 0 ? familyChildren.map((child, i) => (
                <div key={child.id} className="w-8 h-8 rounded-full border-2 border-white bg-[#D1E4FF] flex items-center justify-center text-[10px] font-bold">
                  {child.name.charAt(0)}
                </div>
              )) : (
                <div className="w-8 h-8 rounded-full border-2 border-white bg-[#EFF1F5] flex items-center justify-center text-[10px] font-bold text-[#74777F]">
                  ?
                </div>
              )}
              {familyChildren.length > 3 && (
                <div className="w-8 h-8 rounded-full border-2 border-white bg-white flex items-center justify-center text-[10px] font-bold text-[#44474E]">
                  +{familyChildren.length - 3}
                </div>
              )}
            </div>
            <p className="text-xs text-[#44474E]">
              {user.role === 'family' 
                ? "You have view-only access to linked children's logs." 
                : "Manage who can view your child's progress."}
            </p>
          </div>
        </section>

      </main>
    </div>
  );
}
