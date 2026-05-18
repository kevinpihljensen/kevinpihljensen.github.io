Quake 1 - The Edge 

Restoration of Quake “The Edge conversion” by Tim Willits (Q1Edge).
Using the brush base of “The Edge” from Quake 2 (q2dm1).
alongside small reference from “The Edge”  in Quake Remaster/ Enhanced (DM7).

### Author info / Metadata

Map name: 
Original Author : Tim Willits 
(also thanks to the Level designers who worked on this map in Quake 1 Remaster)
Author of the restoration / conversion : Chuma
Game: id1/Quake intended for multiplayer
Name: The Edge
bsp name: q2dm1q1restoration.bsp

Song : Track 4 from Quake original soundtrack.

## Summary

This map it’s just a restoration of Quake 1 conversion of the Edge for having it’s map source file restored for historical purposes, using Quake 2 imported brush work and references from the 2 official map versions, gameplay doesn’t differ in the slightest, The lighting had to be done from 0 by me, and outside minor coordinate differences, it’s the same map… Report me any feedback or missing texture.

### Information of the map.

This will be a bit “long”… hope to interest or entertain you in some form.

John Romero released the source of the Quake map files in 2006, in the multiplayer map source we got all the DM maps, the interesting part of the story starts with DM7 and DM8, without going into further detail DM7 is originally American Mcgee’s incomplete map Acrophobia and DM8 is an incomplete multiplayer map at least from Romero’s files, within the game history DM7 became Acrophobia / Court of Death and DM8 became Quake 1’s conversion of Quake 2 map The Edge.

With some hiccups the only official Quake multiplayer map without a proper map file source is Quake’s The Edge conversion (i will refer to it as DM8 since we’re talking about Quake 1 multiplayer), my friend ilove80srock has been restoring some of Quake missing maps (check his Sega Saturn port maps for Quake) and i’ve got inspired into doing a some sort of restoration of my own since this is one of my favorite multiplayer maps.

### In-depth Restoration story

With the help of Paril i imported the Quake 2 brushwork into Quake 1, and i manually textured the map within the same textures of Q1EDGE, The brushwork manual work was little but i recreated by hand the teleporter section inside the water river since it doesn’t exist in Quake 2 (this also included some other 2 sections that existed in the Quake 1 conversion but very minor i consider), the toughest was eliminating the exact extra brushes from Quake 2 but it was mostly a persistance thing other than anything else.

After this i imported all the entities to be in the exact same spot from the original map (weapons, items, lights, func_plat, teleporters and it’s brushes), The elevator brush from Quake 2 was slightly different so i had to redo the elevator (using height value since i never made an elevator work without Height).

After the map was basically copy and paste visually the challenge came up here, when compiling with the lights settings i had the map was VERY dark, not an exaggeration, i researched what could be wrong to no avail, i extracted the DM7 map from the Remaster and encountered that at least from what i investigated (looked, compared) the level designers from the remaster encountered the same problem, so they actually used surface lights and bounced the light 16 times even, with all of this almost froze me but i decided to just light it up myself (altho my lighting style in Quake is pretty much defined i decided to go ahead and do it)… We found out it’s possible there were some other light compiler that we’re not aware of hence why the original lights when compiled with light bsp never lit well, after that small adventure, the map was restored in the sense of what this project aimed to do.

### Technical Details of the map file (Layers)

It’s important to know that I’ve used layers, I’m not sure how this map would work in other editors since Trenchbroom for me is the default one i use.

The objective is to have a restored map file version so i better detail the .map file … i’m a fan of working with layers so here are the layers with a brief explanation (they are all locked and can be unlocked in the editor):

- Default Layer : The entire map / brushwork and entities basically.
- Lights Revamp : The lighting i did for the map (with the aid of _bounce_  and _sunlight_ )
- Items from DM7 : They are just 3 cell ammunition that are in the remaster.
- Comment info_nulls : Comments about the map per se, not sure if i left one being a reminder since i have bad memory but i use these entities as comments.

This one compiles but it’s hidden:

- Lights of the current restored map : Self-Explanatory, the original light, they are hidden but they compile.

The next ones are entities hidden and they are omitted from compiling (they should not be compiled they are a layer for archival purposes), in my maps there’s usually some layers i leave out of compile:

- Lights from Source : Basically i copy and pasted the lights from q1edge map, and i couldn’t find one, problem is even if i found it, it wouldn’t help me… i tried a lot of times so yeah (they are some coordinates Y axis up)
- OutofCompile : Brushwork from Quake 2 i decided to hide, some are architecture and geo and others are just a hint brushes from Quake 2.
- Original Quake 2 Wall : In one of the hallways where there is a teleporter, in Quake 2 there’s just a wall, that’s it ( i didn’t setup the LG gun without a teleporter i didn’t consider it necessary, but in Quake 2 this room it’s smaller).

### Technical Details of the map file (Lights and other detail)

- _bounce_ value is 1
- I used lights with wait and delay (some were filler lights).
- There’s no colored lighting i decided to skip it.
- While there were some _surface_ lights in DM7 (remaster) i skipped them entirely.
- There might be a missing texture somewhere if so please report for updating it.
- There was a texture in one of the hallways that looked odd i “fixed” it , it’s one of the hallways above the rocket launcher.
- All the entities were copied and pasted from q1edge from the exact coordinates into this map, except some few cases, the coordinates are the same.
- In my final compile i added some filler lights.

Hope you enjoy this small side project of restoring or recreating the map file for Quake 1 The Edge.

Stay tuned for other maps and other content i do.

Best wishes and positivity for all of you!

### Special thanks and mentions

- bmFbr.
- Paril.
- CommonCold.
- ilove80srock.
- Em3raldTig3r.
- DevSEb.
- riktoi.
- Avix.
- Dooplon.
- Mopey Bloke.
- shark.
- rabbit.
- Makkon.
- Spootnik
- Mikolah.
- RecycledOJ.
- Quake Mapping Discord.
- Pacifist Paradise.
- Map-Center.
- All my personal friends who are always there for supporting me.
