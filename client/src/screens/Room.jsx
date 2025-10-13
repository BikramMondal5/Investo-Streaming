import React, { useEffect, useCallback, useState, useRef } from "react";
import ReactPlayer from "react-player";
import peer from "../service/peer";
import { useSocket } from "../context/SocketProvider";

const RoomPage = () => {
  const socket = useSocket();
  const [remoteSocketId, setRemoteSocketId] = useState(null);
  const [myStream, setMyStream] = useState();
  const [remoteStream, setRemoteStream] = useState();
  const [isMuted, setIsMuted] = useState(false);
  const [isCameraOff, setIsCameraOff] = useState(false);
  const [isScreenSharing, setIsScreenSharing] = useState(false);
  const [screenSharingStream, setScreenSharingStream] = useState(null);
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
    <div className="min-h-screen bg-gray-900 flex flex-col">
      {/* Header */}
      <header className="bg-gray-800 px-6 py-3 shadow-md flex items-center justify-between">
        <div className="flex items-center">
          <svg className="w-8 h-8 text-blue-500" fill="none" stroke="currentColor" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z" />
          </svg>
          <h1 className="ml-2 text-xl font-bold text-white">Investor-Hunter</h1>
        </div>
        <div className="flex items-center space-x-2">
          <div className={`px-3 py-1 rounded-full text-sm ${remoteSocketId ? "bg-green-500 text-white" : "bg-gray-600 text-gray-300"}`}>
            {remoteSocketId ? "Connected" : "Waiting for participants"}
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
              <div className="bg-gray-800 rounded-lg overflow-hidden shadow-lg relative h-90">
                <ReactPlayer
                  playing
                  width="100%"
                  height="100%"
                  url={remoteStream}
                  style={{ objectFit: "contain" }}
                />
                <div className="absolute bottom-4 left-4 bg-gray-900 bg-opacity-70 px-3 py-1 rounded-lg text-white text-sm">
                  Remote User
                </div>
              </div>
            ) : (
              <div className="bg-gray-800 rounded-lg flex items-center justify-center text-gray-500 h-72">
                <div className="text-center">
                  <svg className="mx-auto h-16 w-16" fill="none" stroke="currentColor" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 6v6m0 0v6m0-6h6m-6 0H6" />
                  </svg>
                  <p className="mt-2">Waiting for remote stream</p>
                </div>
              </div>
            )}

            {/* My Stream */}
            {myStream ? (
              <div className="bg-gray-800 rounded-lg overflow-hidden shadow-lg relative h-90">
                <ReactPlayer
                  playing
                  muted
                  width="100%"
                  height="100%"
                  url={myStream}
                  style={{ objectFit: isScreenSharing ? "contain" : "cover" }}
                />
                <div className="absolute bottom-4 left-4 bg-gray-900 bg-opacity-70 px-3 py-1 rounded-lg text-white text-sm flex items-center">
                  {isScreenSharing && (
                    <svg className="w-4 h-4 mr-1" fill="none" stroke="currentColor" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9.75 17L9 20l-1 1h8l-1-1-.75-3M3 13h18M5 17h14a2 2 0 002-2V5a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
                    </svg>
                  )}
                  You {isScreenSharing ? '(Screen)' : ''}
                </div>
              </div>
            ) : (
              <div className="bg-gray-800 rounded-lg flex items-center justify-center text-gray-500 h-72">
                <div className="text-center">
                  <svg className="mx-auto h-16 w-16" fill="none" stroke="currentColor" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 6v6m0 0v6m0-6h6m-6 0H6" />
                  </svg>
                  <p className="mt-2">Waiting for your stream</p>
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Controls */}
        <div className="bg-gray-800 p-4 rounded-lg flex justify-center space-x-4">
          {myStream && (
            <>
              <button 
                onClick={toggleMute}
                className={`p-3 rounded-full ${isMuted ? 'bg-red-600 text-white' : 'bg-gray-700 text-white hover:bg-gray-600'} transition-colors`}
              >
                {isMuted ? (
                  <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5.586 15H4a1 1 0 01-1-1v-4a1 1 0 011-1h1.586l4.707-4.707C10.923 3.663 12 4.109 12 5v14c0 .891-1.077 1.337-1.707.707L5.586 15z" clipRule="evenodd" />
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 14l2-2m0 0l2-2m-2 2l-2-2m2 2l2 2" />
                  </svg>
                ) : (
                  <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 11a7 7 0 01-7 7m0 0a7 7 0 01-7-7m7 7v4m0 0H8m4 0h4m-4-8a3 3 0 01-3-3V5a3 3 0 116 0v6a3 3 0 01-3 3z" />
                  </svg>
                )}
              </button>

              <button 
                onClick={toggleCamera}
                className={`p-3 rounded-full ${isCameraOff ? 'bg-red-600 text-white' : 'bg-gray-700 text-white hover:bg-gray-600'} transition-colors`}
              >
                {isCameraOff ? (
                  <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M18 12H6" />
                  </svg>
                ) : (
                  <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z" />
                  </svg>
                )}
              </button>
              
              {/* Screen Share Button */}
              <button 
                onClick={isScreenSharing ? stopScreenShare : startScreenShare}
                className={`p-3 rounded-full ${isScreenSharing ? 'bg-blue-600 text-white' : 'bg-gray-700 text-white hover:bg-gray-600'} transition-colors`}
                title={isScreenSharing ? "Stop sharing screen" : "Share screen"}
              >
                {isScreenSharing ? (
                  <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 13h6m-3-3v6m-9 1V7a2 2 0 012-2h6l2 2h6a2 2 0 012 2v8a2 2 0 01-2 2H5a2 2 0 01-2-2z" />
                  </svg>
                ) : (
                  <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9.75 17L9 20l-1 1h8l-1-1-.75-3M3 13h18M5 17h14a2 2 0 002-2V5a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
                  </svg>
                )}
              </button>
              
              <button 
                onClick={sendStreams}
                className="p-3 rounded-full bg-blue-600 text-white hover:bg-blue-700 transition-colors"
              >
                <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 11l5-5m0 0l5 5m-5-5v12" />
                </svg>
              </button>
              
              {remoteSocketId && !remoteStream && (
                <button 
                  onClick={handleCallUser}
                  className="px-4 py-2 bg-green-600 text-white rounded-md hover:bg-green-700 transition-colors flex items-center"
                >
                  <svg className="w-5 h-5 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 5a2 2 0 012-2h3.28a1 1 0 01.948.684l1.498 4.493a1 1 0 01-.502 1.21l-2.257 1.13a11.042 11.042 0 005.516 5.516l1.13-2.257a1 1 0 011.21-.502l4.493 1.498a1 1 0 01.684.949V19a2 2 0 01-2 2h-1C9.716 21 3 14.284 3 6V5z" />
                  </svg>
                  Start Call
                </button>
              )}
            </>
          )}
          
          {!myStream && remoteSocketId && (
            <button 
              onClick={handleCallUser}
              className="px-4 py-2 bg-green-600 text-white rounded-md hover:bg-green-700 transition-colors flex items-center"
            >
              <svg className="w-5 h-5 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 5a2 2 0 012-2h3.28a1 1 0 01.948.684l1.498 4.493a1 1 0 01-.502 1.21l-2.257 1.13a11.042 11.042 0 005.516 5.516l1.13-2.257a1 1 0 011.21-.502l4.493 1.498a1 1 0 01.684.949V19a2 2 0 01-2 2h-1C9.716 21 3 14.284 3 6V5z" />
              </svg>
              Join Call
            </button>
          )}
        </div>
      </div>
    </div>
  );
};

export default RoomPage;
