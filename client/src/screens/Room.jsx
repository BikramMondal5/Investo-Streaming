import React, { useEffect, useCallback, useState, useRef } from "react";
import ReactPlayer from "react-player";
import peer from "../service/peer";
import { useSocket } from "../context/SocketProvider";
import { 
  Mic, MicOff, Video, VideoOff, MonitorUp, Users, 
  MessageSquare, Settings, MoreVertical, PhoneOff, Phone,
  Hand, Smile, Layout, ChevronDown, Radio, Clock,
  Shield, Volume2, VolumeX, Maximize2, Copy
} from "lucide-react";

const RoomPage = () => {
  const socket = useSocket();
  const [remoteSocketId, setRemoteSocketId] = useState(null);
  const [myStream, setMyStream] = useState();
  const [remoteStream, setRemoteStream] = useState();
  const [isMuted, setIsMuted] = useState(false);
  const [isCameraOff, setIsCameraOff] = useState(false);
  const [isScreenSharing, setIsScreenSharing] = useState(false);
  const [screenSharingStream, setScreenSharingStream] = useState(null);
  const [isHandRaised, setIsHandRaised] = useState(false);
  const [showChat, setShowChat] = useState(false);
  const [showParticipants, setShowParticipants] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [isRecording, setIsRecording] = useState(false);
  const [meetingDuration, setMeetingDuration] = useState(0);
  const normalVideoStream = useRef(null);

  const handleUserJoined = useCallback(({ email, id }) => {
    console.log(`Email ${email} joined room`);
    setRemoteSocketId(id);
  }, []);

  const handleCallUser = useCallback(async () => {
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: true,
      video: true,
    });
    const offer = await peer.getOffer();
    socket.emit("user:call", { to: remoteSocketId, offer });
    setMyStream(stream);
  }, [remoteSocketId, socket]);

  const handleIncommingCall = useCallback(
    async ({ from, offer }) => {
      setRemoteSocketId(from);
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: true,
        video: true,
      });
      setMyStream(stream);
      console.log(`Incoming Call`, from, offer);
      const ans = await peer.getAnswer(offer);
      socket.emit("call:accepted", { to: from, ans });
    },
    [socket]
  );

  const sendStreams = useCallback(() => {
    if (!myStream) return;
    
    // Check if there are existing senders to avoid adding duplicate tracks
    const senders = peer.peer.getSenders();
    const tracks = myStream.getTracks();
    
    tracks.forEach((track) => {
      // Check if this track or one of the same kind is already being sent
      const sender = senders.find(s => s.track && s.track.kind === track.kind);
      
      if (sender) {
        // Replace the track if there's already a sender of this kind
        sender.replaceTrack(track);
      } else {
        // Add the track if there's no sender yet
        peer.peer.addTrack(track, myStream);
      }
    });
  }, [myStream]);

  const handleCallAccepted = useCallback(
    ({ from, ans }) => {
      peer.setLocalDescription(ans);
      console.log("Call Accepted!");
      sendStreams();
    },
    [sendStreams]
  );

  const handleNegoNeeded = useCallback(async () => {
    const offer = await peer.getOffer();
    socket.emit("peer:nego:needed", { offer, to: remoteSocketId });
  }, [remoteSocketId, socket]);

  useEffect(() => {
    peer.peer.addEventListener("negotiationneeded", handleNegoNeeded);
    return () => {
      peer.peer.removeEventListener("negotiationneeded", handleNegoNeeded);
    };
  }, [handleNegoNeeded]);

  const handleNegoNeedIncomming = useCallback(
    async ({ from, offer }) => {
      const ans = await peer.getAnswer(offer);
      socket.emit("peer:nego:done", { to: from, ans });
    },
    [socket]
  );

  const handleNegoNeedFinal = useCallback(async ({ ans }) => {
    await peer.setLocalDescription(ans);
  }, []);

  useEffect(() => {
    peer.peer.addEventListener("track", async (ev) => {
      const remoteStream = ev.streams;
      console.log("GOT TRACKS!!");
      setRemoteStream(remoteStream[0]);
    });
  }, []);

  // Meeting duration timer
  useEffect(() => {
    const timer = setInterval(() => {
      setMeetingDuration(prev => prev + 1);
    }, 1000);

    return () => clearInterval(timer);
  }, []);

  useEffect(() => {
    socket.on("user:joined", handleUserJoined);
    socket.on("incomming:call", handleIncommingCall);
    socket.on("call:accepted", handleCallAccepted);
    socket.on("peer:nego:needed", handleNegoNeedIncomming);
    socket.on("peer:nego:final", handleNegoNeedFinal);

    return () => {
      // Clean up screen sharing when component unmounts
      if (screenSharingStream) {
        screenSharingStream.getTracks().forEach(track => track.stop());
      }
      
      socket.off("user:joined", handleUserJoined);
      socket.off("incomming:call", handleIncommingCall);
      socket.off("call:accepted", handleCallAccepted);
      socket.off("peer:nego:needed", handleNegoNeedIncomming);
      socket.off("peer:nego:final", handleNegoNeedFinal);
    };
  }, [
    socket,
    handleUserJoined,
    handleIncommingCall,
    handleCallAccepted,
    handleNegoNeedIncomming,
    handleNegoNeedFinal,
    screenSharingStream,
  ]);

  // Functions to handle mute/unmute and camera on/off
  const toggleMute = useCallback(() => {
    if (myStream) {
      const audioTracks = myStream.getAudioTracks();
      if (audioTracks.length > 0) {
        audioTracks[0].enabled = isMuted;
        setIsMuted(!isMuted);
      }
    }
  }, [isMuted, myStream]);

  const toggleCamera = useCallback(() => {
    if (myStream) {
      const videoTracks = myStream.getVideoTracks();
      if (videoTracks.length > 0) {
        videoTracks[0].enabled = isCameraOff;
        setIsCameraOff(!isCameraOff);
      }
    }
  }, [isCameraOff, myStream]);

  // Start screen sharing
  const startScreenShare = useCallback(async () => {
    try {
      // Save the current video stream to restore later
      if (myStream && !normalVideoStream.current) {
        normalVideoStream.current = myStream;
      }
      
      // Get screen sharing stream
      const screenStream = await navigator.mediaDevices.getDisplayMedia({
        video: true,
        audio: true
      });
      
      // Handle the case when user cancels screen share dialog
      screenStream.getVideoTracks()[0].onended = () => {
        stopScreenShare();
      };
      
      setScreenSharingStream(screenStream);
      setIsScreenSharing(true);
      
      // Replace the current stream with screen sharing stream
      setMyStream(screenStream);
      
      // Replace the tracks that are being sent
      const senders = peer.peer.getSenders();
      const videoSender = senders.find(sender => 
        sender.track && sender.track.kind === 'video'
      );
      
      if (videoSender) {
        videoSender.replaceTrack(screenStream.getVideoTracks()[0]);
      }
      
    } catch (error) {
      console.error('Error starting screen share:', error);
    }
  }, [myStream]);
  
  // Stop screen sharing
  const stopScreenShare = useCallback(async () => {
    try {
      if (screenSharingStream) {
        screenSharingStream.getTracks().forEach(track => track.stop());
        setScreenSharingStream(null);
      }
      
      // Restore the original video stream
      if (normalVideoStream.current) {
        setMyStream(normalVideoStream.current);
        
        // Replace the screen sharing track with the original video track
        const senders = peer.peer.getSenders();
        const videoSender = senders.find(sender => 
          sender.track && sender.track.kind === 'video'
        );
        
        if (videoSender && normalVideoStream.current.getVideoTracks()[0]) {
          videoSender.replaceTrack(normalVideoStream.current.getVideoTracks()[0]);
        }
      }
      
      setIsScreenSharing(false);
    } catch (error) {
      console.error('Error stopping screen share:', error);
    }
  }, [screenSharingStream]);

  return (
    <div className="min-h-screen bg-gradient-to-br from-gray-900 via-gray-800 to-gray-900 flex flex-col">
      {/* Enhanced Header/Navbar */}
      <header className="bg-gray-900/95 backdrop-blur-md border-b border-gray-700 px-6 py-3 shadow-xl">
        <div className="flex items-center justify-between">
          {/* Left Section - Logo and Meeting Info */}
          <div className="flex items-center space-x-4">
            <div className="flex items-center">
              <div className="bg-gradient-to-r from-blue-500 to-purple-600 p-2 rounded-lg">
                <Video className="w-6 h-6 text-white" />
              </div>
              <h1 className="ml-3 text-xl font-bold text-white">Investo-Streaming</h1>
            </div>
            
            {/* Meeting Duration */}
            <div className="hidden md:flex items-center space-x-2 bg-gray-800 px-3 py-1.5 rounded-lg">
              <Clock className="w-4 h-4 text-gray-400" />
              <span className="text-sm text-gray-300">
                {Math.floor(meetingDuration / 60)}:{String(meetingDuration % 60).padStart(2, '0')}
              </span>
            </div>

            {/* Recording Indicator */}
            {isRecording && (
              <div className="flex items-center space-x-2 bg-red-600/20 border border-red-500 px-3 py-1.5 rounded-lg animate-pulse">
                <Radio className="w-4 h-4 text-red-500" />
                <span className="text-sm text-red-400 font-medium">Recording</span>
              </div>
            )}
          </div>

          {/* Center Section - Connection Status */}
          <div className="hidden lg:flex items-center">
            <div className={`flex items-center space-x-2 px-4 py-2 rounded-full border transition-all ${
              remoteSocketId 
                ? "bg-green-500/20 border-green-500 text-green-400" 
                : "bg-yellow-500/20 border-yellow-500 text-yellow-400"
            }`}>
              <div className={`w-2 h-2 rounded-full ${remoteSocketId ? 'bg-green-500' : 'bg-yellow-500'} animate-pulse`}></div>
              <Shield className="w-4 h-4" />
              <span className="text-sm font-medium">
                {remoteSocketId ? "Secure Connection" : "Waiting for participants"}
              </span>
            </div>
          </div>

          {/* Right Section - Action Buttons */}
          <div className="flex items-center space-x-2">
            {/* Participant Count */}
            <button 
              onClick={() => setShowParticipants(!showParticipants)}
              className="hidden sm:flex items-center space-x-2 bg-gray-800 hover:bg-gray-700 px-4 py-2 rounded-lg transition-all group"
            >
              <Users className="w-5 h-5 text-gray-300 group-hover:text-white" />
              <span className="text-sm text-gray-300 group-hover:text-white font-medium">
                {remoteSocketId ? '2' : '1'}
              </span>
            </button>

            {/* Chat Toggle */}
            <button 
              onClick={() => setShowChat(!showChat)}
              className={`p-2.5 rounded-lg transition-all ${
                showChat 
                  ? 'bg-blue-600 text-white' 
                  : 'bg-gray-800 hover:bg-gray-700 text-gray-300 hover:text-white'
              }`}
              title="Toggle Chat"
            >
              <MessageSquare className="w-5 h-5" />
            </button>

            {/* Layout Toggle */}
            <button 
              className="p-2.5 bg-gray-800 hover:bg-gray-700 rounded-lg transition-all text-gray-300 hover:text-white"
              title="Change Layout"
            >
              <Layout className="w-5 h-5" />
            </button>

            {/* Settings */}
            <button 
              onClick={() => setShowSettings(!showSettings)}
              className={`p-2.5 rounded-lg transition-all ${
                showSettings 
                  ? 'bg-gray-700 text-white' 
                  : 'bg-gray-800 hover:bg-gray-700 text-gray-300 hover:text-white'
              }`}
              title="Settings"
            >
              <Settings className="w-5 h-5" />
            </button>

            {/* More Options */}
            <button 
              className="p-2.5 bg-gray-800 hover:bg-gray-700 rounded-lg transition-all text-gray-300 hover:text-white"
              title="More Options"
            >
              <MoreVertical className="w-5 h-5" />
            </button>
          </div>
        </div>
      </header>

      {/* Main content */}
      <div className="flex-1 p-4 flex flex-col">
        {/* Video Area */}
        <div className="flex flex-1 gap-4 mb-4 overflow-hidden">
          {/* Container to hold both streams with equal size */}
          <div className="grid grid-cols-2 gap-4 w-full">
            {/* Remote Stream */}
            {remoteStream ? (
              <div className="bg-gray-800 rounded-xl overflow-hidden shadow-2xl relative h-90 border border-gray-700 hover:border-blue-500 transition-all">
                <ReactPlayer
                  playing
                  width="100%"
                  height="100%"
                  url={remoteStream}
                  style={{ objectFit: "contain" }}
                />
                <div className="absolute bottom-4 left-4 bg-gray-900/90 backdrop-blur-sm px-4 py-2 rounded-lg text-white text-sm flex items-center space-x-2 border border-gray-700">
                  <div className="w-2 h-2 rounded-full bg-green-500"></div>
                  <span className="font-medium">Remote User</span>
                </div>
                {/* Video Controls Overlay */}
                <div className="absolute top-4 right-4 flex space-x-2">
                  <button className="p-2 bg-gray-900/80 hover:bg-gray-800 rounded-lg transition-all">
                    <Maximize2 className="w-4 h-4 text-white" />
                  </button>
                </div>
              </div>
            ) : (
              <div className="bg-gradient-to-br from-gray-800 to-gray-900 rounded-xl flex items-center justify-center text-gray-500 h-72 border border-gray-700 border-dashed">
                <div className="text-center">
                  <div className="bg-gray-700/50 p-4 rounded-full mx-auto w-fit mb-4">
                    <Users className="h-16 w-16 text-gray-400" />
                  </div>
                  <p className="text-lg font-medium">Waiting for remote stream</p>
                  <p className="text-sm text-gray-600 mt-1">Participant will appear here</p>
                </div>
              </div>
            )}

            {/* My Stream */}
            {myStream ? (
              <div className="bg-gray-800 rounded-xl overflow-hidden shadow-2xl relative h-90 border border-gray-700 hover:border-purple-500 transition-all">
                <ReactPlayer
                  playing
                  muted
                  width="100%"
                  height="100%"
                  url={myStream}
                  style={{ objectFit: isScreenSharing ? "contain" : "cover" }}
                />
                <div className="absolute bottom-4 left-4 bg-gray-900/90 backdrop-blur-sm px-4 py-2 rounded-lg text-white text-sm flex items-center space-x-2 border border-gray-700">
                  <div className="w-2 h-2 rounded-full bg-blue-500"></div>
                  {isScreenSharing && <MonitorUp className="w-4 h-4 text-blue-400" />}
                  <span className="font-medium">You {isScreenSharing ? '(Sharing)' : ''}</span>
                </div>
                {/* Hand Raised Indicator */}
                {isHandRaised && (
                  <div className="absolute top-4 left-4 bg-yellow-500 px-3 py-2 rounded-lg flex items-center space-x-2 animate-bounce">
                    <Hand className="w-5 h-5 text-white" />
                    <span className="text-white font-medium text-sm">Hand Raised</span>
                  </div>
                )}
              </div>
            ) : (
              <div className="bg-gradient-to-br from-gray-800 to-gray-900 rounded-xl flex items-center justify-center text-gray-500 h-72 border border-gray-700 border-dashed">
                <div className="text-center">
                  <div className="bg-gray-700/50 p-4 rounded-full mx-auto w-fit mb-4">
                    <Video className="h-16 w-16 text-gray-400" />
                  </div>
                  <p className="text-lg font-medium">Camera Off</p>
                  <p className="text-sm text-gray-600 mt-1">Turn on your camera to start</p>
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Enhanced Controls Bar */}
        <div className="bg-gray-900/95 backdrop-blur-md border border-gray-700 p-4 rounded-xl shadow-2xl">
          <div className="flex items-center justify-between">
            {/* Left Controls - Audio/Video */}
            <div className="flex items-center space-x-3">
              {myStream && (
                <>
                  {/* Microphone Control */}
                  <div className="relative group">
                    <button 
                      onClick={toggleMute}
                      className={`p-4 rounded-xl transition-all duration-200 ${
                        isMuted 
                          ? 'bg-red-600 hover:bg-red-700 text-white shadow-lg shadow-red-500/50' 
                          : 'bg-gray-800 hover:bg-gray-700 text-white'
                      }`}
                      title={isMuted ? "Unmute" : "Mute"}
                    >
                      {isMuted ? <MicOff className="w-6 h-6" /> : <Mic className="w-6 h-6" />}
                    </button>
                    <ChevronDown className="absolute -bottom-1 right-1 w-4 h-4 text-gray-400 group-hover:text-white cursor-pointer" />
                  </div>

                  {/* Camera Control */}
                  <div className="relative group">
                    <button 
                      onClick={toggleCamera}
                      className={`p-4 rounded-xl transition-all duration-200 ${
                        isCameraOff 
                          ? 'bg-red-600 hover:bg-red-700 text-white shadow-lg shadow-red-500/50' 
                          : 'bg-gray-800 hover:bg-gray-700 text-white'
                      }`}
                      title={isCameraOff ? "Turn on camera" : "Turn off camera"}
                    >
                      {isCameraOff ? <VideoOff className="w-6 h-6" /> : <Video className="w-6 h-6" />}
                    </button>
                    <ChevronDown className="absolute -bottom-1 right-1 w-4 h-4 text-gray-400 group-hover:text-white cursor-pointer" />
                  </div>
                </>
              )}
            </div>

            {/* Center Controls - Main Actions */}
            <div className="flex items-center space-x-3">
              {myStream && (
                <>
                  {/* Screen Share */}
                  <button 
                    onClick={isScreenSharing ? stopScreenShare : startScreenShare}
                    className={`px-4 py-3 rounded-xl transition-all duration-200 flex items-center space-x-2 ${
                      isScreenSharing 
                        ? 'bg-blue-600 hover:bg-blue-700 text-white shadow-lg shadow-blue-500/50' 
                        : 'bg-gray-800 hover:bg-gray-700 text-white'
                    }`}
                    title={isScreenSharing ? "Stop sharing" : "Share screen"}
                  >
                    <MonitorUp className="w-5 h-5" />
                    <span className="text-sm font-medium hidden sm:inline">
                      {isScreenSharing ? "Stop Share" : "Share"}
                    </span>
                  </button>

                  {/* Reactions */}
                  <button 
                    className="p-3 bg-gray-800 hover:bg-gray-700 text-white rounded-xl transition-all"
                    title="Reactions"
                  >
                    <Smile className="w-5 h-5" />
                  </button>

                  {/* Raise Hand */}
                  <button 
                    onClick={() => setIsHandRaised(!isHandRaised)}
                    className={`p-3 rounded-xl transition-all duration-200 ${
                      isHandRaised 
                        ? 'bg-yellow-500 hover:bg-yellow-600 text-white shadow-lg shadow-yellow-500/50' 
                        : 'bg-gray-800 hover:bg-gray-700 text-white'
                    }`}
                    title={isHandRaised ? "Lower hand" : "Raise hand"}
                  >
                    <Hand className="w-5 h-5" />
                  </button>

                  {/* Record Button */}
                  <button 
                    onClick={() => setIsRecording(!isRecording)}
                    className={`px-4 py-3 rounded-xl transition-all duration-200 flex items-center space-x-2 ${
                      isRecording 
                        ? 'bg-red-600 hover:bg-red-700 text-white shadow-lg shadow-red-500/50' 
                        : 'bg-gray-800 hover:bg-gray-700 text-white'
                    }`}
                    title={isRecording ? "Stop recording" : "Start recording"}
                  >
                    <Radio className={`w-5 h-5 ${isRecording ? 'animate-pulse' : ''}`} />
                    <span className="text-sm font-medium hidden md:inline">
                      {isRecording ? "Recording..." : "Record"}
                    </span>
                  </button>
                </>
              )}

              {/* Call Control - Join Call when no stream */}
              {!myStream && remoteSocketId && (
                <button 
                  onClick={handleCallUser}
                  className="px-6 py-3 bg-gradient-to-r from-green-600 to-green-700 hover:from-green-700 hover:to-green-800 text-white rounded-xl transition-all shadow-lg shadow-green-500/50 flex items-center space-x-2 font-medium"
                >
                  <Phone className="w-5 h-5" />
                  <span>Join Call</span>
                </button>
              )}

              {/* Send My Stream - Available for both users */}
              {myStream && remoteSocketId && (
                <button 
                  onClick={sendStreams}
                  className="px-6 py-3 bg-gradient-to-r from-green-600 to-green-700 hover:from-green-700 hover:to-green-800 text-white rounded-xl transition-all shadow-lg shadow-green-500/50 flex items-center space-x-2 font-medium"
                  title="Send my video stream to other user"
                >
                  <Phone className="w-5 h-5" />
                  <span>Send My Stream</span>
                </button>
              )}
            </div>

            {/* Right Controls - End Call */}
            <div className="flex items-center space-x-3">
              {/* End Call Button */}
              <button 
                className="px-5 py-3 bg-gradient-to-r from-red-600 to-red-700 hover:from-red-700 hover:to-red-800 text-white rounded-xl transition-all shadow-lg shadow-red-500/50 flex items-center space-x-2 font-medium"
                title="End call"
              >
                <PhoneOff className="w-5 h-5" />
                <span className="hidden md:inline">End</span>
              </button>
            </div>
          </div>

          {/* Quick Info Bar */}
          <div className="mt-3 pt-3 border-t border-gray-800 flex items-center justify-between text-xs text-gray-400">
            <div className="flex items-center space-x-4">
              <span className="flex items-center space-x-1">
                <Shield className="w-3 h-3" />
                <span>Encrypted</span>
              </span>
              <span>Room ID: {remoteSocketId ? remoteSocketId.substring(0, 8) + '...' : 'N/A'}</span>
            </div>
            <button className="flex items-center space-x-1 hover:text-blue-400 transition-colors">
              <Copy className="w-3 h-3" />
              <span>Copy Invite Link</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

export default RoomPage;
