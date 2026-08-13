fn main() {
    let s = String::from("hi");
    take(s);
    println!("{s}");
}

fn take(_s: String) {}
