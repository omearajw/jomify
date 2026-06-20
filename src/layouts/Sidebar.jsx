import { useState } from 'react';
import { Home, Library, Disc3, Folder, ChevronRight, ChevronDown, ChevronLeft, Plus } from 'lucide-react';
import { useUserStore } from '../store/userStore';
import { addTracksToPlaylist } from '../services/spotify/api';

export default function Sidebar() {
  const { 
    token, currentView, setCurrentView, logout, playlists, 
    setActivePlaylistId, customFolders, createFolder,
    draggedItem, setDraggedItem, reorderFolders, 
    addPlaylistToFolder, reorderPlaylistInFolder
  } = useUserStore();
  
  const [isolatedFolderId, setIsolatedFolderId] = useState(null);
  const [expandedFolders, setExpandedFolders] = useState([]);
  const [dragOverId, setDragOverId] = useState(null);

  const activeFolder = customFolders.find(f => f.id === isolatedFolderId);
  const unfolderedPlaylists = playlists.filter(p => !customFolders.some(f => f.playlistIds.includes(p.id)));

  const toggleFolderExpand = (e, folderId) => {
    e.stopPropagation();
    setExpandedFolders(prev => prev.includes(folderId) ? prev.filter(id => id !== folderId) : [...prev, folderId]);
  };

  const handleCreateFolder = () => {
    const name = window.prompt("Enter new folder name:");
    if (name && name.trim()) createFolder(name.trim());
  };

  const handleDragStart = (e, item) => {
    e.stopPropagation();
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', item.id);
    setTimeout(() => { setDraggedItem(item); }, 0);
  };

  const handleDragOver = (e, id) => { 
    e.preventDefault(); 
    e.stopPropagation();
    
    // FIX: Dynamically switch the drop effect so the browser removes the stop sign
    if (draggedItem?.type === 'track') {
      e.dataTransfer.dropEffect = 'copy';
    } else {
      e.dataTransfer.dropEffect = 'move';
    }
    
    if (dragOverId !== id) setDragOverId(id);
  };

  const handleDragLeave = () => setDragOverId(null);
  const handleDragEnd = () => { setDraggedItem(null); setDragOverId(null); };

  const handleDropOnFolder = (e, targetFolderId) => {
    e.preventDefault(); e.stopPropagation();
    setDragOverId(null);
    if (!draggedItem) return;

    if (draggedItem.type === 'folder' && draggedItem.id !== targetFolderId) {
      reorderFolders(draggedItem.id, targetFolderId);
    } else if (draggedItem.type === 'playlist') {
      addPlaylistToFolder(targetFolderId, draggedItem.id);
    }
    setDraggedItem(null);
  };

  // NEW: Bulletproof Native Drop Handler
  const handleDropOnPlaylist = async (e, targetPlaylistId, parentFolderId) => {
    e.preventDefault(); e.stopPropagation();
    setDragOverId(null);

    const droppedUri = e.dataTransfer.getData('text/plain');

    if (droppedUri && droppedUri.includes('spotify:track:')) {
      try {
        await addTracksToPlaylist(token, targetPlaylistId, [droppedUri]);
        console.log('Successfully added track to playlist via Sidebar!');
      } catch (err) {
        console.error('Failed to drop track:', err);
      }
      setDraggedItem(null);
      return;
    }

    if (!draggedItem || draggedItem.type !== 'playlist' || !parentFolderId) return;

    if (draggedItem.parentFolderId === parentFolderId && draggedItem.id !== targetPlaylistId) {
      reorderPlaylistInFolder(parentFolderId, draggedItem.id, targetPlaylistId);
    }
    setDraggedItem(null);
  };

  const navItems = [
    { id: 'home', label: 'Home', icon: Home },
    { id: 'browse', label: 'Browse', icon: Disc3 },
    { id: 'library', label: 'Your Library', icon: Library },
  ];

  return (
    <aside className="w-64 bg-black flex flex-col p-6 space-y-6 select-none overflow-hidden h-full">
      <div className="text-green-500 font-extrabold text-3xl tracking-tighter shrink-0">Jomify</div>
      
      <nav className="flex flex-col space-y-4 font-semibold shrink-0">
        {navItems.map((item) => {
          const Icon = item.icon;
          const isActive = currentView === item.id;
          return (
            <button
              key={item.id}
              onClick={() => { setIsolatedFolderId(null); setCurrentView(item.id); }}
              className={`flex items-center space-x-4 transition-colors duration-200 text-left ${isActive ? 'text-white font-bold' : 'text-neutral-400 hover:text-white'}`}
            >
              <Icon className={`w-6 h-6 ${isActive ? 'text-green-500' : ''}`} />
              <span>{item.label}</span>
            </button>
          );
        })}
      </nav>

      <hr className="border-neutral-800 shrink-0" />

      <div className="flex-1 overflow-y-auto pr-2 -mr-2 space-y-1 custom-scrollbar text-sm font-medium">
        
        {activeFolder ? (
          <div className="animate-fade-in">
            <button onClick={() => setIsolatedFolderId(null)} className="flex items-center text-neutral-400 hover:text-white mb-4 transition-colors group">
              <ChevronLeft className="w-5 h-5 mr-1 group-hover:-translate-x-1 transition-transform" /> Back
            </button>
            <h3 className="text-white font-bold text-lg px-2 mb-3 flex items-center">
              <Folder className="w-5 h-5 mr-2 text-green-500 fill-current" /> {activeFolder.name}
            </h3>
            <div className="space-y-1 pl-2">
              {activeFolder.playlistIds.map(id => {
                const pl = playlists.find(p => p.id === id);
                if (!pl) return null;
                const isDragTarget = dragOverId === pl.id;
                
                return (
                  <button 
                    key={pl.id} 
                    draggable="true"
                    onDragStart={(e) => handleDragStart(e, { type: 'playlist', id: pl.id, parentFolderId: activeFolder.id })}
                    onDragOver={(e) => handleDragOver(e, pl.id)}
                    onDragLeave={handleDragLeave}
                    onDragEnd={handleDragEnd} 
                    onDrop={(e) => handleDropOnPlaylist(e, pl.id, activeFolder.id)}
                    onClick={() => { setActivePlaylistId(pl.id); setCurrentView('playlist'); }}
                    className={`w-full text-left px-2 py-1.5 transition-colors flex items-center group cursor-grab active:cursor-grabbing rounded-md ${isDragTarget ? 'bg-green-500/20 text-white border border-green-500/50' : 'text-neutral-400 hover:text-white'}`}
                  >
                    <div className="w-6 h-6 rounded bg-neutral-800 overflow-hidden mr-3 shrink-0 shadow-sm pointer-events-none">
                      {pl.images?.[0]?.url ? <img src={pl.images[0].url} draggable="false" alt="" className="w-full h-full object-cover pointer-events-none" /> : <span className="text-[10px] flex items-center justify-center w-full h-full opacity-50">💿</span>}
                    </div>
                    <span className="truncate pointer-events-none">{pl.name}</span>
                  </button>
                );
              })}
            </div>
          </div>
        ) : (
          <div className="animate-fade-in space-y-1">
            <div className="flex items-center justify-between px-2 pb-2 text-neutral-400">
              <span className="text-xs uppercase tracking-wider font-bold">Playlists</span>
              <button onClick={handleCreateFolder} className="hover:text-white transition-colors" title="Create Folder"><Plus className="w-4 h-4" /></button>
            </div>

            {customFolders.map(folder => {
              const isExpanded = expandedFolders.includes(folder.id);
              const isDragTarget = dragOverId === folder.id;
              
              return (
                <div key={folder.id} className="flex flex-col">
                  <div 
                    draggable="true"
                    onDragStart={(e) => handleDragStart(e, { type: 'folder', id: folder.id })}
                    onDragOver={(e) => handleDragOver(e, folder.id)}
                    onDragLeave={handleDragLeave}
                    onDragEnd={handleDragEnd} 
                    onDrop={(e) => handleDropOnFolder(e, folder.id)}
                    onClick={() => setIsolatedFolderId(folder.id)}
                    className={`flex items-center w-full px-2 py-2 rounded-md cursor-pointer group transition-colors cursor-grab active:cursor-grabbing ${isDragTarget ? 'bg-green-500/20 text-white border border-green-500/50' : draggedItem?.type === 'playlist' ? 'text-neutral-300 hover:bg-neutral-800/50 border border-dashed border-green-500/30 bg-green-500/5' : 'text-neutral-300 hover:text-white hover:bg-neutral-800/50'}`}
                  >
                    <button onClick={(e) => toggleFolderExpand(e, folder.id)} className="p-0.5 hover:bg-neutral-700 rounded text-neutral-400 hover:text-white mr-1 transition-colors">
                      {isExpanded ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
                    </button>
                    <Folder className="w-4 h-4 mr-3 shrink-0 pointer-events-none" />
                    <span className="truncate pointer-events-none">{folder.name}</span>
                  </div>
                  
                  {isExpanded && (
                    <div className="pl-9 pr-2 space-y-1 mt-1 mb-2">
                      {folder.playlistIds.map(id => {
                        const pl = playlists.find(p => p.id === id);
                        if (!pl) return null;
                        const isSubDragTarget = dragOverId === pl.id;
                        return (
                          <button 
                            key={pl.id}
                            draggable="true"
                            onDragStart={(e) => handleDragStart(e, { type: 'playlist', id: pl.id, parentFolderId: folder.id })}
                            onDragOver={(e) => handleDragOver(e, pl.id)}
                            onDragLeave={handleDragLeave}
                            onDragEnd={handleDragEnd} 
                            onDrop={(e) => handleDropOnPlaylist(e, pl.id, folder.id)}
                            onClick={() => { setActivePlaylistId(pl.id); setCurrentView('playlist'); }}
                            className={`w-full text-left py-1.5 transition-colors flex items-center group cursor-grab active:cursor-grabbing rounded ${isSubDragTarget ? 'bg-green-500/20 text-white border border-green-500/50 px-2 -ml-2' : 'text-neutral-400 hover:text-white'}`}
                          >
                            <div className="w-6 h-6 rounded bg-neutral-800 overflow-hidden mr-3 shrink-0 shadow-sm pointer-events-none">
                              {pl.images?.[0]?.url ? <img src={pl.images[0].url} draggable="false" alt="" className="w-full h-full object-cover pointer-events-none" /> : <span className="text-[10px] flex items-center justify-center w-full h-full opacity-50">💿</span>}
                            </div>
                            <span className="truncate pointer-events-none">{pl.name}</span>
                          </button>
                        );
                      })}
                    </div>
                  )}
                </div>
              );
            })}

            <div className="pt-2 space-y-1">
              {unfolderedPlaylists.map(pl => {
                const isDragTarget = dragOverId === pl.id; // Added visual glow support
                
                return (
                  <button 
                    key={pl.id}
                    draggable="true"
                    onDragStart={(e) => handleDragStart(e, { type: 'playlist', id: pl.id, parentFolderId: null })}
                    onDragOver={(e) => handleDragOver(e, pl.id)}
                    onDragLeave={handleDragLeave}
                    onDragEnd={handleDragEnd}
                    onDrop={(e) => handleDropOnPlaylist(e, pl.id, null)} // Now catches dropped tracks
                    onClick={() => { setActivePlaylistId(pl.id); setCurrentView('playlist'); }}
                    className={`w-full text-left px-2 py-1.5 transition-colors rounded-md flex items-center group cursor-grab active:cursor-grabbing ${isDragTarget ? 'bg-green-500/20 text-white border border-green-500/50' : 'text-neutral-400 hover:text-white hover:bg-neutral-800/50'}`}
                  >
                    <div className="w-8 h-8 rounded bg-neutral-800 overflow-hidden mr-3 shrink-0 shadow-sm pointer-events-none">
                      {pl.images?.[0]?.url ? <img src={pl.images[0].url} draggable="false" alt="" className="w-full h-full object-cover pointer-events-none" /> : <span className="text-[10px] flex items-center justify-center w-full h-full opacity-50">💿</span>}
                    </div>
                    <span className="truncate pointer-events-none">{pl.name}</span>
                  </button>
                );
              })}
            </div>
          </div>
        )}
      </div>

      <div className="mt-auto border-t border-neutral-800 pt-6 flex flex-col space-y-2 text-xs text-neutral-600 shrink-0">
        <p>Built for pure audio.</p>
        <button onClick={() => { logout(); window.location.href = "/"; }} className="text-left hover:text-white transition-colors">Disconnect Account</button>
      </div>
    </aside>
  );
}