let balance = 1000;

const balanceElement = document.getElementById("balance");
const casesElement = document.querySelector(".cases");
const roulette = document.querySelector(".roulette");
const openButton = document.querySelector(".open-button");

const cases = [
{
    name:"AK-47",
    price:399,
    image:"images/ak.png",
    items:[
        "AK-47 Slate",
        "AK-47 Redline",
        "AK-47 Asiimov",
        "AK-47 Neon Rider",
        "AK-47 Fire Serpent"
    ]
},
{
    name:"M4A4",
    price:599,
    image:"images/m4.png",
    items:[
        "M4A4 Desolate Space",
        "M4A4 Emperor",
        "M4A4 Neo-Noir",
        "M4A4 Buzz Kill"
    ]
},
{
    name:"M4A1-S",
    price:299,
    image:"images/m4a1s.png",
    items:[
        "M4A1-S Printstream",
        "M4A1-S Nightmare",
        "M4A1-S Hyper Beast"
    ]
},
{
    name:"Knife",
    price:1200,
    image:"images/knife.png",
    items:[
        "Karambit",
        "Butterfly",
        "Bayonet",
        "M9 Bayonet",
        "Flip Knife"
    ]
},
{
    name:"Freddy",
    price:899,
    image:"images/freddy.png",
    items:[
        "Golden Freddy",
        "Nightmare Freddy",
        "Classic Freddy"
    ]
}
];

balanceElement.innerText = balance + " ₽";

let selectedCase = null;

document.querySelectorAll(".case-card").forEach((card,index)=>{

    card.addEventListener("click",()=>{

        selectedCase = cases[index];

        document.querySelector(".open-window").scrollIntoView({
            behavior:"smooth"
        });

    });

});

openButton.onclick = ()=>{

    if(selectedCase==null){

        alert("Выберите кейс");

        return;

    }

    if(balance<selectedCase.price){

        alert("Недостаточно средств");

        return;

    }

    balance-=selectedCase.price;

    balanceElement.innerText=balance+" ₽";

    roulette.innerHTML="";

    const result=document.createElement("h2");

    const item=selectedCase.items[
        Math.floor(Math.random()*selectedCase.items.length)
    ];

    result.innerHTML="🎉 Выпало:<br><br>"+item;

    result.style.textAlign="center";
    result.style.paddingTop="55px";

    roulette.appendChild(result);

};